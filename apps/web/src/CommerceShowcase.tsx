import { useEffect, useState } from 'react';
import { CommerceServicesResponseSchema, type CommerceService } from '@co-vibe/contracts';
import { commerce } from './commerce-api';
import { useI18n } from './i18n';

const modeText: Record<string, { zh: string; en: string }> = {
  disabled: { zh: '收费服务未开通，免费服务可完整体验', en: 'Paid services are not enabled; the free service is fully available' },
  simulated: { zh: '内部模拟支付，仅验证状态机，不代表支付宝官方支付', en: 'Internal simulated payment; not official Alipay payment' },
  sandbox: { zh: '支付宝沙箱支付，不代表正式支付成功', en: 'Alipay sandbox payment; not a production payment' },
  production: { zh: '支付宝正式支付', en: 'Alipay production payment' },
};
const envText: Record<string, { zh: string; en: string }> = {
  local: { zh: '本地环境', en: 'local environment' },
  test: { zh: '测试环境', en: 'test environment' },
  staging: { zh: '预发布环境', en: 'staging environment' },
  production: { zh: '正式环境', en: 'production environment' },
};

function price(service: CommerceService) {
  return service.priceFen === 0 ? null : `CNY ${(service.priceFen / 100).toFixed(2)}`;
}

export default function CommerceShowcase({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<ReturnType<typeof CommerceServicesResponseSchema.parse> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    commerce('/services', CommerceServicesResponseSchema, { signal: controller.signal })
      .then(record => { if (!controller.signal.aborted) setCatalog(record); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const free = catalog?.services.find(service => service.priceFen === 0) ?? null;
  const paid = catalog?.services.filter(service => service.priceFen > 0) ?? [];
  const status = catalog ? `${t(modeText[catalog.paymentMode]?.zh ?? catalog.paymentMode, modeText[catalog.paymentMode]?.en ?? catalog.paymentMode)} · ${t(envText[catalog.deploymentEnv]?.zh ?? catalog.deploymentEnv, envText[catalog.deploymentEnv]?.en ?? catalog.deploymentEnv)}` : t('正在读取服务目录…', 'Loading service catalog…');

  return <section className="public-panel commerce-showcase" aria-label={t('可验证的 AI Agent 服务', 'Verifiable AI agent services')}>
    <div className="public-section-head">
      <div>
        <h2>{t('购买或体验可验证的 AI Agent 服务', 'Buy or experience verifiable AI agent services')}</h2>
        <p className="public-muted">{t(
          'CrewTrace 把一次 CSV 清洗拆给三个 AI Agent 执行：固定规则分工、独立执行、机器复算验收，全部过程和信誉记录都可以核对。',
          'CrewTrace splits one CSV cleaning job across three AI agents: deterministic assignment, independent execution, machine recomputation, and an auditable record.',
        )}</p>
      </div>
      <div className="public-actions"><button className="primary" onClick={onOpen}>{free ? t('免费体验', 'Try the free service') : t('查看服务与订单', 'View services and orders')}</button></div>
    </div>
    <p className="notice" data-mode={catalog?.paymentMode ?? 'loading'}>{status}</p>
    {free && <article className="public-record">
      <span className="public-pill">{t('免费', 'Free')}</span>
      <strong>{free.title}</strong>
      <p>{free.summary}</p>
      <p className="public-muted">{t('约', 'About')} {free.deliveryMinutes} {t('分钟', 'minutes')} · {t('支付状态：无需支付', 'Payment: not required')} · {t('三 Agent 执行与机器验收', 'Three-agent execution with machine verification')}</p>
      <button className="secondary" onClick={onOpen}>{t('立即体验', 'Start now')}</button>
    </article>}
    {paid.map(service => <article className="public-record" key={service.serviceId}>
      <span className="public-pill">{price(service)}</span>
      <strong>{service.title}</strong>
      <p>{service.summary}</p>
      <p className="public-muted">{t('约', 'About')} {service.deliveryMinutes} {t('分钟', 'minutes')} · {t('支付状态：', 'Payment: ')}{catalog?.paymentMode === 'disabled' ? t('收费未开通', 'paid service not enabled') : catalog?.paymentMode === 'simulated' ? t('模拟支付', 'simulated') : catalog?.paymentMode === 'sandbox' ? t('支付宝沙箱', 'Alipay sandbox') : t('支付宝正式支付', 'Alipay production')}</p>
    </article>)}
    <p className="public-muted">{t(
      '完整流程：提交 CSV、自动分工、三个 Agent 分别执行、机器复算验收、下载成果、买家验收、写入信誉记录。免费、模拟、沙箱与正式收费在界面和接口中都单独标注。',
      'Full flow: submit CSV, automatic assignment, three agents execute, machine recomputation, download deliverables, buyer acceptance, and reputation records. Free, simulated, sandbox and production payments are labelled separately.',
    )}</p>
  </section>;
}
