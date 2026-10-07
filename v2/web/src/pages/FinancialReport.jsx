import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { API, get } from '../lib/api';
import { accessToken } from '../lib/supabase';
import { currentOrgId } from '../lib/org';
import { useToast } from '../lib/toast';
import { peso } from '../lib/money';
import { Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** FRF-formatted view of a project's budget — print or download as .docx. */
export default function FinancialReport() {
  const { id } = useParams();
  const org = currentOrgId();
  const toast = useToast();

  const q = useQuery({
    queryKey: ['financial-report', org, id],
    queryFn: () => get(`/orgs/${org}/projects/${id}/financial-report`),
    enabled: !!org,
  });

  const docx = async () => {
    try {
      const token = await accessToken();
      const res = await fetch(
        `${API}/orgs/${org}/projects/${id}/financial-report.docx`,
        { headers: { authorization: `Bearer ${token}`, 'x-org-id': org } });
      if (!res.ok) throw new Error('Report download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${q.data.project.title}-financial-report.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(e.message); }
  };

  const openReceipt = async (receiptId) => {
    try {
      const r = await get(`/orgs/${org}/receipts/${receiptId}/url`);
      window.open(r.download_url, '_blank', 'noopener');
    } catch (e) { toast.error(e.message); }
  };

  const openResolution = async (budgetId) => {
    try {
      const r = await get(`/orgs/${org}/budgets/${budgetId}/resolution/url`);
      window.open(r.download_url, '_blank', 'noopener');
    } catch (e) { toast.error(e.message); }
  };

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data;
  const fund = d.fund;
  const sig = d.signatories;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader
          title="Financial report"
          description="Laid out like the Financial Report Form — print it or download the .docx and fill in the rest."
          action={(
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> Print
              </Button>
              <Button onClick={docx}><Download size={16} /> Download .docx</Button>
            </div>
          )}
        />
        <Link to={`/projects/${id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]">
          <ArrowLeft size={12} /> Back to project
        </Link>
      </div>

      <Card className="space-y-4">
        <div className="text-center">
          <div className="heading-strong text-xl">Financial Report Form (FRF)</div>
        </div>

        <div>
          <div className="label-strong text-xs text-[var(--color-ink-3)]">Activity details</div>
          <table className="mt-1 w-full text-sm">
            <tbody>
              <tr className="[border-bottom:var(--border-el)]">
                <td className="py-1.5 pr-2 font-medium">Title of Activity: {d.project.title}</td>
                <td className="py-1.5">Date: {d.project.target_date ?? '—'}</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2">Nature of Activity: {d.project.event_type ?? '—'}</td>
                <td className="py-1.5" />
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div className="label-strong text-xs text-[var(--color-ink-3)]">Collection and expenses</div>
          <div className="mt-1 text-sm">
            Source of Fund: {fund.source_label ?? 'Bankbook'}
            {fund.withdrawn_on ? ` as of ${fund.withdrawn_on}` : ''}
          </div>
          <div className="mt-1 flex justify-between text-sm font-medium">
            <span>Total Fund:</span><span>{peso(fund.allocated_centavos)}</span>
          </div>
          {d.resolution?.document_title && (
            <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
              Authorized by: {d.resolution.document_title}
            </div>
          )}
          {d.resolution?.has_file && (
            <button
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] underline print:hidden"
              onClick={() => openResolution(d.resolution.budget_id)}
            >
              <Download size={11} /> Resolution scan
            </button>
          )}
        </div>

        <div>
          <div className="text-sm font-medium">Less Expenses</div>
          {d.expenses_by_vendor.map((g, i) => (
            <div key={i} className="mt-2">
              <div className="text-xs font-semibold text-[var(--color-ink-3)]">
                {i + 1}. {g.vendor ?? 'Miscellaneous'}
              </div>
              {g.items.map((it, j) => (
                <div key={j} className="flex justify-between py-0.5 pl-4 text-sm">
                  <span>
                    {it.item}
                    {it.receipts.map((r) => (
                      <button key={r.id}
                              className="ml-1.5 align-middle text-[var(--color-accent)] underline print:hidden"
                              onClick={() => openReceipt(r.id)}>
                        receipt
                      </button>
                    ))}
                  </span>
                  <span>{peso(it.amount_centavos)}</span>
                </div>
              ))}
              <div className="flex justify-between py-0.5 pl-4 text-sm font-medium">
                <span>Total:</span><span>{peso(g.subtotal_centavos)}</span>
              </div>
            </div>
          ))}
          <div className="mt-3 space-y-1 [border-top:var(--border-box)] pt-2">
            <div className="flex justify-between text-sm font-semibold">
              <span>Total Expenses</span><span>{peso(d.totals.spent_centavos)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold">
              <span>Total Remaining Fund</span><span>{peso(d.totals.remaining_centavos)}</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-[var(--color-ink-3)]">
          <p>Note: Please see attached pictures of receipts for proof of payment.</p>
          {d.return && (
            <p className="mt-1">
              Note: The bankbook reflects a deposit of {peso(d.return.amount_centavos)} on{' '}
              {d.return.deposited_on} — the remaining fund from "{d.project.title}". The total
              bank balance after the deposit is {peso(d.return.balance_after_centavos)}.
            </p>
          )}
        </div>

        <div className="grid gap-4 pt-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-[var(--color-ink-3)]">AUDITED AND PREPARED BY:</div>
            <div className="mt-3 font-medium">{sig.auditor ?? '____________________'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-ink-3)]">NOTED BY:</div>
            <div className="mt-3 font-medium">{sig.treasurer ?? '____________________'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-ink-3)]">RECOMMENDING APPROVAL BY:</div>
            <div className="mt-3 font-medium">{sig.president ?? '____________________'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-ink-3)]">APPROVED BY:</div>
            <div className="mt-3 font-medium">{sig.adviser ?? '____________________'}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
