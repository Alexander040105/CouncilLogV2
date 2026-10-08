import { useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Building2, ChevronRight, LogOut, Plus } from 'lucide-react';
import { currentOrgId, orgPicked, setCurrentOrg, setOrgPicked } from '../lib/org';
import { supabase } from '../lib/supabase';
import { humanize } from '../lib/labels';
import { Card } from '../components/ui';

export default function OrgPicker() {
  const nav = useNavigate();
  const { me } = useOutletContext() ?? {};
  const memberships = me?.memberships ?? [];
  const lastUsed = currentOrgId();
  const sorted = [...memberships].sort((a, b) =>
    (a.org_id === lastUsed ? -1 : 0) - (b.org_id === lastUsed ? -1 : 0));

  // Picked already (e.g. navigated here by hand after choosing) or single-org:
  // nothing to decide — go where the data takes you.
  useEffect(() => {
    if (!me) return;
    if (memberships.length === 0) nav('/onboarding', { replace: true });
    else if (memberships.length === 1 || orgPicked()) {
      setCurrentOrg(memberships.length === 1 ? memberships[0].org_id : lastUsed ?? memberships[0].org_id);
      setOrgPicked();
      nav('/', { replace: true });
    }
  }, [me, memberships.length]);

  const pick = (orgId) => { setCurrentOrg(orgId); setOrgPicked(); nav('/'); };
  const signOut = () => { supabase.auth.signOut(); setCurrentOrg(null); setOrgPicked(false); };

  if (!me || memberships.length <= 1) return null;

  return (
    <div className="mx-auto max-w-md space-y-4 py-8">
      <div className="space-y-1 text-center">
        <h1 className="heading-strong text-2xl">Choose an organization</h1>
        <p className="text-sm text-[var(--color-ink-3)]">
          You belong to {memberships.length} organizations — pick which one to open. You can switch anytime.
        </p>
      </div>

      <div className="space-y-2">
        {sorted.map((m) => (
          <button key={m.org_id} onClick={() => pick(m.org_id)} className="block w-full text-left">
            <Card className="flex items-center gap-3 transition-colors hover:border-[var(--color-accent)]">
              <Building2 size={20} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.org_name}</span>
                <span className="text-xs text-[var(--color-ink-3)]">
                  {m.org_id === lastUsed ? 'Last used · ' : ''}{humanize(m.role)}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-[var(--color-ink-3)]" aria-hidden />
            </Card>
          </button>
        ))}

        <button onClick={() => nav('/onboarding')} className="block w-full text-left">
          <Card className="flex items-center gap-3 border-dashed transition-colors hover:border-[var(--color-accent)]">
            <Plus size={20} className="shrink-0 text-[var(--color-ink-3)]" aria-hidden />
            <span className="flex-1 text-sm text-[var(--color-ink-2)]">Create or join another organization</span>
            <ChevronRight size={16} className="shrink-0 text-[var(--color-ink-3)]" aria-hidden />
          </Card>
        </button>
      </div>

      <button
        onClick={signOut}
        className="mx-auto flex items-center gap-2 text-sm text-[var(--color-ink-3)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-ink)]"
      >
        <LogOut size={14} aria-hidden /> Sign out instead
      </button>
    </div>
  );
}
