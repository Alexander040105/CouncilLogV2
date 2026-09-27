import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Empty } from '../components/ui';

export default function NotFound() {
  return (
    <Empty
      icon={<FileQuestion size={28} />}
      title="Page not found"
      hint="That page doesn't exist — the link may be wrong or it moved."
      action={<Link to="/" className="text-sm text-[var(--color-accent)] underline">Back to Today</Link>}
    />
  );
}
