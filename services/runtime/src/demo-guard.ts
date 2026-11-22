import type { PoolClient } from 'pg';
import type { Application } from './application.js';
import { AppError } from './errors.js';

type Queryable = Pick<PoolClient, 'query'>;

const DEMO_PAUSE_KEY = 'demo_pause';
/** 容量专用事务级 advisory lock，所有连接与进程按同一键串行核对活动订单数。 */
const DEMO_CAPACITY_LOCK = 83521002;

export interface OrderReservation {
  agentId: string;
  clientAddress: string;
  now?: Date;
}

/**
 * 公开免费 Demo 的数据库共享配额。
 *
 * 所有计数使用单条 UPSERT 原子递增，并在超限时不返回行；
 * 调用方必须在创建订单的同一事务中调用，失败时整体回滚。
 */
export class DemoGuard {
  constructor(private readonly app: Application) {}

  get enabled(): boolean {
    return this.app.config.PUBLIC_DEPLOYMENT;
  }

  private day(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  async paused(client: Queryable = this.app.db.pool): Promise<boolean> {
    const row = (await client.query(`SELECT value FROM runtime_settings WHERE key='${DEMO_PAUSE_KEY}'`)).rows[0] as { value?: { paused?: boolean } } | undefined;
    return row?.value?.paused === true;
  }

  async setPaused(paused: boolean): Promise<{ paused: boolean; updatedAt: string }> {
    const updatedAt = new Date().toISOString();
    await this.app.db.pool.query(
      `INSERT INTO runtime_settings(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=now()`,
      [DEMO_PAUSE_KEY, { paused, updatedAt }],
    );
    return { paused, updatedAt };
  }

  private async consume(client: Queryable, scope: string, bucket: string, limit: number, message: string): Promise<number> {
    const inserted = await client.query(
      `INSERT INTO demo_usage_counters(scope,bucket,used) VALUES($1,$2,1)
       ON CONFLICT(scope,bucket) DO UPDATE SET used=demo_usage_counters.used+1,updated_at=now()
       WHERE demo_usage_counters.used < $3
       RETURNING used`,
      [scope, bucket, limit],
    );
    if (inserted.rows[0]) return Number(inserted.rows[0].used);
    const current = (await client.query('SELECT used FROM demo_usage_counters WHERE scope=$1 AND bucket=$2', [scope, bucket])).rows[0];
    throw new AppError(429, 'DEMO_QUOTA_EXCEEDED', message, {
      details: { scope, limit, used: current ? Number(current.used) : limit },
    });
  }

  /** 在创建订单事务内预占额度。调用方必须已确认订单是新建而非幂等重放。 */
  async reserveOrder(client: Queryable, input: OrderReservation): Promise<void> {
    if (!this.enabled) return;
    // 容量核对与订单插入必须在同一事务内持有同一把锁，事务结束自动释放。
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [DEMO_CAPACITY_LOCK]);
    if (await this.paused(client)) {
      throw new AppError(503, 'DEMO_PAUSED', '免费 Demo 已暂停接受新订单，请稍后再试');
    }
    const active = Number((await client.query("SELECT count(*) FROM commerce_orders WHERE status IN ('READY','IN_PROGRESS')")).rows[0].count);
    if (active >= this.app.config.DEMO_MAX_ACTIVE_ORDERS) {
      throw new AppError(503, 'DEMO_CAPACITY_REACHED', '当前同时执行的任务已达到上限，请稍后重试', {
        details: { active, limit: this.app.config.DEMO_MAX_ACTIVE_ORDERS },
      });
    }
    const date = this.day(input.now ?? new Date());
    await this.consume(client, 'order:global', date, this.app.config.DEMO_GLOBAL_ORDERS_PER_DAY, '今日免费 Demo 订单总额度已用完，请明天再试');
    await this.consume(client, 'order:ip', `${input.clientAddress}|${date}`, this.app.config.DEMO_IP_ORDERS_PER_DAY, '该网络地址今日免费订单额度已用完');
    await this.consume(client, 'order:agent', `${input.agentId}|${date}`, this.app.config.DEMO_AGENT_ORDERS_PER_DAY, '该 Agent 今日免费订单额度已用完');
  }

  async reserveRegistration(client: Queryable, clientAddress: string, now = new Date()): Promise<void> {
    if (!this.enabled) return;
    if (await this.paused(client)) {
      throw new AppError(503, 'DEMO_PAUSED', '免费 Demo 已暂停注册新的 Agent');
    }
    await this.consume(
      client, 'registration:ip', `${clientAddress}|${this.day(now)}`,
      this.app.config.DEMO_AGENT_REGISTRATIONS_PER_IP_DAY,
      '该网络地址今日注册 Agent 的数量已达上限',
    );
  }

  async reserveCollaborationTask(client: Queryable, agentId: string, now = new Date()): Promise<void> {
    if (!this.enabled) return;
    if (await this.paused(client)) {
      throw new AppError(503, 'DEMO_PAUSED', '免费 Demo 已暂停创建新的协作任务');
    }
    await this.consume(
      client, 'task:global', this.day(now), this.app.config.DEMO_DAILY_TASKS,
      '今日协作任务总额度已用完',
    );
    await this.consume(
      client, 'task:agent', `${agentId}|${this.day(now)}`, this.app.config.DEMO_AGENT_ORDERS_PER_DAY,
      '该 Agent 今日协作任务额度已用完',
    );
  }

  /** 管理端可观测数据：额度、并发与 Worker 在线状态。 */
  async ops(now = new Date()) {
    const date = this.day(now);
    const counters = await this.app.db.pool.query(
      'SELECT scope,bucket,used,updated_at FROM demo_usage_counters WHERE bucket=$1 OR bucket LIKE $2 ORDER BY scope,bucket',
      [date, `%|${date}`],
    );
    const statuses = await this.app.db.pool.query(
      `SELECT status,count(*)::int AS count FROM commerce_orders GROUP BY status ORDER BY status`,
    );
    const today = await this.app.db.pool.query(
      `SELECT count(*)::int AS created,
              count(*) FILTER (WHERE status='COMPLETED')::int AS completed
       FROM commerce_orders WHERE created_at >= date_trunc('day', now())`,
    );
    const execution = await this.app.db.pool.query(
      `SELECT avg(extract(epoch FROM ((document->>'deliveredAt')::timestamptz - created_at)))::float AS average_seconds
       FROM commerce_orders
       WHERE created_at >= date_trunc('day', now()) AND document->>'deliveredAt' IS NOT NULL`,
    );
    const workers = await this.app.db.pool.query(
      `SELECT agent_id,max(polled_at) AS polled_at FROM experiment_worker_presence GROUP BY agent_id ORDER BY agent_id`,
    );
    const configured = this.app.config.EXPERIMENT_WORKER_AGENT_IDS?.split(',') ?? [];
    const online = workers.rows.filter(row => now.getTime() - new Date(row.polled_at as string).getTime() <= 30_000);
    return {
      deployment: {
        sha: this.app.config.DEPLOYMENT_SHA ?? null,
        env: this.app.config.DEPLOYMENT_ENV,
        publicDeployment: this.app.config.PUBLIC_DEPLOYMENT,
        paused: await this.paused(),
      },
      orders: {
        total: statuses.rows.reduce((sum, row) => sum + Number(row.count), 0),
        byStatus: Object.fromEntries(statuses.rows.map(row => [row.status as string, Number(row.count)])),
        today: Number(today.rows[0]?.created ?? 0),
        completedToday: Number(today.rows[0]?.completed ?? 0),
        averageExecutionSeconds: execution.rows[0]?.average_seconds === null ? null : Number(execution.rows[0]?.average_seconds ?? 0),
        active: Number(statuses.rows.filter(row => row.status === 'READY' || row.status === 'IN_PROGRESS').reduce((sum, row) => sum + Number(row.count), 0)),
      },
      workers: {
        configured: configured.length,
        online: online.length,
        lastSeen: workers.rows.map(row => ({ agentId: row.agent_id, polledAt: row.polled_at })),
      },
      quotas: {
        date,
        limits: {
          globalOrdersPerDay: this.app.config.DEMO_GLOBAL_ORDERS_PER_DAY,
          ipOrdersPerDay: this.app.config.DEMO_IP_ORDERS_PER_DAY,
          agentOrdersPerDay: this.app.config.DEMO_AGENT_ORDERS_PER_DAY,
          registrationsPerIpDay: this.app.config.DEMO_AGENT_REGISTRATIONS_PER_IP_DAY,
          dailyTasks: this.app.config.DEMO_DAILY_TASKS,
          maxActiveOrders: this.app.config.DEMO_MAX_ACTIVE_ORDERS,
          maxInputChars: this.app.config.DEMO_MAX_INPUT_CHARS,
          maxInputRows: this.app.config.DEMO_MAX_INPUT_ROWS,
        },
        usage: counters.rows.map(row => ({ scope: row.scope, bucket: row.bucket, used: Number(row.used), updatedAt: row.updated_at })),
      },
      payment: { mode: this.app.config.PAYMENT_MODE },
    };
  }
}
