import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { Check, CalendarCheck, FileText, FolderKanban, Users } from 'lucide-react';
import { get } from '../lib/api';
import { currentOrgId, todayOrg } from '../lib/org';
import { Button, Card, Chip, Empty, ErrorState, HintBanner, PageHeader, Skeleton } from '../components/ui';

export default function Dashboard() {
  const { me } = useOutletContext();
  const org = currentOrgId();
  const today = todayOrg();

  const att = useQuery({
    queryKey: ['attendance', 'day', org, today],
    queryFn: () => get(`/orgs/${org}/attendance?day=${today}`),
    enabled: !!org,
  });
  const positions = useQuery({
    queryKey: ['positions', org],
    queryFn: () => get(`/orgs/${org}/positions`),
    enabled: !!org,
  });

  const myRow = att.data?.data.find((r) => r.member_id === me?.id);
  const isFresh =
    positions.data && positions.data.data.length === 0 &&
    att.data && att.data.data.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Today"
        description="Your duty day at a glance: file once, you're accounted."
      />

      <HintBanner id="dashboard">
        File a journal entry on your assigned day — or tap "No tasks today". That's all it
        takes to be counted present. Papers and projects live in their own tabs.
      </HintBanner>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--color-ink-3)]">Your day</div>
            <div className="text-lg font-semibold">
              {myRow ? (myRow.status === 'documented' ? 'Documented' : 'No tasks declared') : 'Nothing filed yet'}
            </div>
          </div>
          {myRow && (
            <Chip
              kind={myRow.status === 'documented' ? 'done' : 'neutral'}
              label={myRow.duty_type === 'extra' ? 'extra duty' : 'on duty'}
              icon={<Check size={12} />}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Link to="/journal?compose=1" className="flex-1"><Button className="w-full">Log work</Button></Link>
          <Link to="/journal?notasks=1" className="flex-1"><Button variant="secondary" className="w-full">No tasks today</Button></Link>
        </div>
      </Card>

      {isFresh && (
        <Card>
          <div className="label-strong mb-2 text-sm text-[var(--color-ink-2)]">New here? How CounciLog works</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-2)]">
            <li>File a journal entry each duty day — that's your attendance.</li>
            <li><Link className="text-[var(--color-accent)]" to="/documents">Papers</Link> tracks where physical documents are and who's signing them.</li>
            <li><Link className="text-[var(--color-accent)]" to="/projects">Projects</Link> holds events and their paperwork + logistics checklists.</li>
            <li>Admins set up positions, duty days, and templates in <Link className="text-[var(--color-accent)]" to="/settings">Settings</Link>.</li>
          </ul>
        </Card>
      )}

      <Card>
        <div className="label-strong mb-2 text-sm text-[var(--color-ink-2)]">Duty roster today</div>
        {att.isLoading && <Skeleton className="h-16" />}
        {att.isError && <ErrorState error={att.error} retry={att.refetch} />}
        {att.data && att.data.data.length === 0 && att.data.unaccounted_member_ids.length === 0 && (
          <Empty icon={<CalendarCheck size={24} />} title="No duty entries yet" hint="Be the first to file today." />
        )}
        {att.data && (att.data.data.length > 0 || att.data.unaccounted_member_ids.length > 0) && (
          <div className="space-y-1 text-sm">
            <div>{att.data.data.length} entries filed today</div>
            {att.data.unaccounted_member_ids.length > 0 && (
              <div className="text-[var(--color-status-alert)]">
                {att.data.unaccounted_member_ids.length} scheduled member(s) haven't filed yet
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="label-strong text-sm text-[var(--color-ink-2)]">Quick links</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link to="/projects"><Button variant="secondary" className="w-full"><FolderKanban size={16} />Projects</Button></Link>
          <Link to="/documents"><Button variant="secondary" className="w-full"><FileText size={16} />Papers</Button></Link>
          <Link to="/attendance"><Button variant="secondary" className="w-full"><CalendarCheck size={16} />Attendance</Button></Link>
          <Link to="/members"><Button variant="secondary" className="w-full"><Users size={16} />Org chart</Button></Link>
        </div>
      </Card>
    </div>
  );
}
