import { useEffect, useState } from 'react';
import {
  CommerceServicesResponseSchema, CreateOrderRequestSchema, DeliveryDownloadSchema,
  AcceptanceSchema, OrderDetailSchema, OrdersResponseSchema, PaymentRequestResponseSchema, type CommerceService,
  type CommerceOrder, type CommerceOrderDetail, type PaymentRequestResponse,
} from '@co-vibe/contracts';
import { Download, RefreshCw } from 'lucide-react';
import ActionForm, { field } from './ActionForm';
import { commerce, commerceError } from './commerce-api';
import { useI18n } from './i18n';

const statusText: Record<string, string> = {
  AWAITING_PAYMENT: '待支付', READY: '等待执行', IN_PROGRESS: '执行中', DELIVERED: '已交付',
  ACCEPTED: '已验收通过', DECLINED: '验收未通过', FAILED: '执行失败', EXPIRED: '支付超时', CANCELLED: '已取消',
};
const stepText: Record<string, string> = { PENDING: '待执行', ACTIVE: '执行中', COMPLETED: '已完成', FAILED: '失败' };
const modeText: Record<string, string> = { disabled: '未开通（仅免费服务可用）', sandbox: '支付宝沙箱', production: '支付宝生产', simulated: '内部模拟（非官方支付）' };
const SAMPLE = 'name,email,joined\n Alice , alice@example.com ,2025-01-02\nBob,bob@example.com,\n';

function price(service: { priceFen: number }) { return service.priceFen === 0 ? '免费' : `CNY ${(service.priceFen / 100).toFixed(2)}`; }

export default function CommercePanel({ credential, onRegister }: { credential: string; onRegister: () => void }) {
  const { t } = useI18n();
  const [services, setServices] = useState<CommerceService[]>([]);
  const [mode, setMode] = useState('disabled');
  const [orders, setOrders] = useState<CommerceOrder[]>([]);
  const [selected, setSelected] = useState<CommerceOrderDetail | null>(null);
  const [payment, setPayment] = useState<PaymentRequestResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [serviceId, setServiceId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const catalog = await commerce('/services', CommerceServicesResponseSchema, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setServices(catalog.services); setMode(catalog.paymentMode);
        setServiceId(current => current || catalog.services[0]?.serviceId || '');
        if (credential) setOrders((await commerce('/orders?limit=20', OrdersResponseSchema, { credential, signal: controller.signal })).orders);
        else setOrders([]);
        setError('');
      } catch (problem) { if (!controller.signal.aborted) setError(commerceError(problem)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [credential, reload]);

  const activeStatus = selected?.status;
  useEffect(() => {
    if (!selected || !credential || !['AWAITING_PAYMENT', 'READY', 'IN_PROGRESS'].includes(selected.status)) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        setSelected(await commerce(`/orders/${selected.orderId}`, OrderDetailSchema, { credential, signal: controller.signal }));
      } catch (problem) { if (!controller.signal.aborted) setError(commerceError(problem)); }
    }, 2500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected?.orderId, activeStatus, credential]);

  async function open(orderId: string) {
    setError('');
    try { setSelected(await commerce(`/orders/${orderId}`, OrderDetailSchema, { credential })); setPayment(null); }
    catch (problem) { setError(commerceError(problem)); }
  }

  async function prepay(orderId: string) {
    setError('');
    try { setPayment(await commerce(`/orders/${orderId}/payment`, PaymentRequestResponseSchema, { method: 'POST', credential, body: {} })); }
    catch (problem) { setError(commerceError(problem)); }
  }

  async function prove(orderId: string, header: string) {
    setError('');
    try {
      await commerce(`/orders/${orderId}/payment-proof`, PaymentRequestResponseSchema.pick({ orderId: true, status: true }), {
        method: 'POST', credential, headers: { 'Payment-Proof': header },
      });
      setPayment(null);
      await open(orderId);
    } catch (problem) { setError(commerceError(problem)); }
  }

  async function accept(orderId: string, decision: 'ACCEPTED' | 'DECLINED', rating: number, comment: string) {
    setError('');
    try {
      await commerce(`/orders/${orderId}/acceptance`, AcceptanceSchema.pick({ orderId: true, decision: true }), {
        method: 'POST', credential, body: { decision, rating: rating || null, comment: comment || null },
      });
      await open(orderId); setReload(value => value + 1);
    } catch (problem) { setError(commerceError(problem)); }
  }

  async function download(orderId: string) {
    setError('');
    try {
      const delivery = await commerce(`/orders/${orderId}/delivery`, DeliveryDownloadSchema, { credential });
      const url = URL.createObjectURL(new Blob([delivery.content], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `crewtrace-${orderId.slice(0, 8)}.csv`; link.click();
      URL.revokeObjectURL(url);
    } catch (problem) { setError(commerceError(problem)); }
  }

  const service = services.find(item => item.serviceId === serviceId) ?? services[0] ?? null;

  return <div className="commerce-panel">
    <p className="notice" data-mode={mode}>
      {t('当前支付模式：', 'Payment mode: ')}{modeText[mode] ?? mode}
      {mode === 'simulated' && t('。此模式只验证内部状态机，模拟凭证不代表支付宝官方支付成功。', '. This mode only verifies the internal state machine; simulated proofs are not evidence of official Alipay payment.')}
      {mode === 'disabled' && t('。收费服务需要配置支付宝官方参数与 PAYMENT_MODE 后才能支付。', '. Priced services require official Alipay configuration and PAYMENT_MODE before payment is possible.')}
    </p>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="public-task-subsection">
      <h3>{t('服务与定价', 'Services and pricing')}</h3>
      {loading && <p className="public-muted">{t('正在读取服务目录…', 'Loading service catalog…')}</p>}
      {services.map(item => <article className="public-record" key={`${item.serviceId}-${item.serviceVersion}`}>
        <strong>{item.title}</strong> <span className="public-pill">{price(item)}</span>
        <p>{item.summary}</p>
        <p className="public-muted">{t('版本', 'Version')} {item.serviceVersion} · {item.workflowVersion} · {t('预计', 'About')} {item.deliveryMinutes} {t('分钟', 'minutes')}</p>
        <button className="secondary" onClick={() => setServiceId(item.serviceId)} aria-pressed={serviceId === item.serviceId}>{t('选择此服务', 'Choose this service')}</button>
      </article>)}
    </section>
    <section className="public-task-subsection">
      <h3>{t('创建订单', 'Create an order')}</h3>
      {!credential ? <button className="primary" onClick={onRegister}>{t('加入后下单', 'Join to create an order')}</button> : service && <ActionForm label={t('提交订单', 'Submit order')} onSubmit={async data => {
        const order = await commerce('/orders', OrderDetailSchema, {
          method: 'POST', credential,
          body: CreateOrderRequestSchema.parse({
            serviceId: service.serviceId, expectedServiceVersion: service.serviceVersion,
            idempotencyKey: crypto.randomUUID(), inputCsv: field(data, 'inputCsv'),
          }),
        });
        setSelected(order); setPayment(null); setReload(value => value + 1);
      }}>
        <label>{t('服务', 'Service')}<select name="serviceId" value={service.serviceId} onChange={event => setServiceId(event.target.value)}>{services.map(item => <option key={item.serviceId} value={item.serviceId}>{item.title} · {price(item)}</option>)}</select></label>
        <label>{t('待清洗的 CSV', 'CSV to clean')}<textarea name="inputCsv" required defaultValue={SAMPLE} rows={6}/></label>
      </ActionForm>}
    </section>
    <section className="public-task-subsection">
      <h3>{t('历史订单', 'Order history')}</h3>
      <div className="public-actions"><button className="secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={15}/> {t('刷新', 'Refresh')}</button></div>
      {orders.map(item => <article className="public-record" key={item.orderId}>
        <span className="public-pill">{statusText[item.status] ?? item.status}</span>
        <strong>{item.quote.title}</strong>
        <p className="public-muted">{item.orderId.slice(0, 8)} · {price(item.quote as CommerceService)} · {new Date(item.createdAt).toLocaleString()}</p>
        <button className="secondary" onClick={() => void open(item.orderId)}>{t('查看订单', 'View order')}</button>
      </article>)}
      {!orders.length && <p className="public-empty">{t('还没有订单。选择一个服务并提交 CSV 即可开始。', 'No orders yet. Choose a service and submit a CSV to begin.')}</p>}
    </section>
    {selected && <OrderDetailView order={selected} payment={payment} onPrepay={prepay} onProve={prove} onAccept={accept} onDownload={download} />}
  </div>;
}

function OrderDetailView({ order, payment, onPrepay, onProve, onAccept, onDownload }: {
  order: CommerceOrderDetail; payment: PaymentRequestResponse | null;
  onPrepay: (orderId: string) => Promise<void>; onProve: (orderId: string, header: string) => Promise<void>;
  onAccept: (orderId: string, decision: 'ACCEPTED' | 'DECLINED', rating: number, comment: string) => Promise<void>;
  onDownload: (orderId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [proof, setProof] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return <section className="public-task-subsection" data-order-id={order.orderId}>
    <h3>{t('订单详情', 'Order detail')} · {order.orderId.slice(0, 8)}</h3>
    <p><span className="public-pill">{statusText[order.status] ?? order.status}</span> {order.quote.title} · CNY {(order.quote.priceFen / 100).toFixed(2)}</p>
    <p className="public-muted">{t('支付状态', 'Payment')}: {order.payment.status} · {t('方式', 'Mode')}: {order.payment.mode} · {t('金额', 'Amount')}: CNY {(order.payment.amountFen / 100).toFixed(2)}{order.payment.providerTradeNo ? ` · ${t('交易号', 'Trade No.')} ${order.payment.providerTradeNo}` : ''}</p>
    {order.status === 'AWAITING_PAYMENT' && order.payment.payable && <div className="public-actions">
      <button className="primary" onClick={() => void onPrepay(order.orderId)}>{t('发起支付', 'Start payment')}</button>
    </div>}
    {payment && <div className="public-record">
      <p className="public-muted">{payment.instruction}</p>
      {payment.prepay?.qrCodeUrl && <p><a href={payment.prepay.qrCodeUrl} target="_blank" rel="noreferrer">{t('打开支付宝支付页面', 'Open Alipay checkout')}</a></p>}
      {payment.simulated && <p className="notice" data-mode="simulated">{t('内部模拟凭证，仅用于验证状态机，不是官方支付成功证据。', 'Internal simulated proof for state-machine testing only, not evidence of official payment.')}</p>}
      {payment.simulatedProof && <button className="secondary" onClick={() => void onProve(order.orderId, payment.simulatedProof!)}>{t('提交内部模拟凭证', 'Submit internal simulated proof')}</button>}
      {!payment.simulated && <label>{t('Payment-Proof 请求头内容', 'Payment-Proof header')}<input value={proof} onChange={event => setProof(event.target.value)}/></label>}
      {!payment.simulated && <button className="secondary" disabled={!proof} onClick={() => void onProve(order.orderId, proof)}>{t('提交官方支付凭证', 'Submit official proof')}</button>}
    </div>}
    <h3>{t('执行进度', 'Execution')}</h3>
    <p className="public-muted">{order.execution.status}{order.execution.workflowVersion ? ` · ${order.execution.workflowVersion}` : ''}</p>
    {order.execution.steps.map(step => <article className="public-record" key={step.role}>
      <strong>{step.title}</strong> <span className="public-pill">{stepText[step.status] ?? step.status}</span>
      <p className="public-muted">{step.role}{step.agentId ? ` · ${step.agentId.slice(0, 8)}` : ''}{step.attempt ? ` · ${t('尝试', 'attempt')} ${step.attempt}` : ''}</p>
    </article>)}
    {order.execution.failure && <p className="error">{order.execution.failure.code}: {order.execution.failure.message}</p>}
    {order.status === 'DELIVERED' && <div className="public-actions">
      <button className="secondary" onClick={() => void onDownload(order.orderId)}><Download size={15}/> {t('下载清洗结果', 'Download cleaned CSV')}</button>
    </div>}
    {order.status === 'DELIVERED' && <div className="public-record">
      <h3>{t('买家验收', 'Buyer acceptance')}</h3>
      <label>{t('评分（1-5）', 'Rating (1-5)')}<input type="number" min={1} max={5} value={rating} onChange={event => setRating(Number(event.target.value))}/></label>
      <label>{t('备注', 'Comment')}<textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={2000}/></label>
      <div className="public-actions">
        <button className="primary" onClick={() => void onAccept(order.orderId, 'ACCEPTED', rating, comment)}>{t('验收通过', 'Accept delivery')}</button>
        <button className="secondary" onClick={() => void onAccept(order.orderId, 'DECLINED', rating, comment)}>{t('验收不通过', 'Decline delivery')}</button>
      </div>
    </div>}
    {order.acceptance && <div className="public-record">
      <strong>{order.acceptance.decision === 'ACCEPTED' ? t('验收通过', 'Accepted') : t('验收未通过', 'Declined')}</strong>
      <p className="public-muted">{t('评分', 'Rating')}: {order.acceptance.rating ?? '-'} · {order.acceptance.comment ?? ''}</p>
      {order.acceptance.reputation.map(item => <p className="public-muted" key={item.role}>{item.role}: {item.outcome ?? t('未记录信誉事件', 'no reputation event')} ({item.source})</p>)}
    </div>}
    <h3>{t('订单状态历史', 'Order history')}</h3>
    {order.history.map(event => <p className="public-muted" key={event.seq}>{new Date(event.createdAt).toLocaleString()} · {event.type} · {event.actor}</p>)}
    <p className="public-muted">{t('交付摘要', 'Delivery')}: {order.deliveryId ? `${order.deliveryId.slice(0, 8)} · v${order.deliveryVersion}` : t('尚未交付', 'not delivered yet')}</p>
  </section>;
}
