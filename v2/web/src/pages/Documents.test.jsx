/** ChainPreview — the register-sheet route preview. Includes the regression
 *  for the prod crash: visibleChainSteps was called with positional args and
 *  a null eventType detonated the destructure, taking down /documents. */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ChainPreview } from './Documents.jsx';

const chains = [
  {
    id: 'c1', name: 'Standard Concept Paper', doc_type: 'concept_paper',
    steps: [
      { ord: 1, label: 'Org President', office: 'office 1', condition_json: null },
      { ord: 2, label: 'Intl desk', office: null,
        condition_json: { include_if_event_type: 'webinar_intl' } },
      { ord: 3, label: 'Merch desk', office: null,
        condition_json: { include_if_flag: 'has_merch' } },
    ],
  },
  { id: 'c2', name: 'Letter route', doc_type: 'letter', steps: [{ ord: 1, label: 'L1' }] },
];

function renderPreview(props, { role = 'owner' } = {}) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={{ active: { role } }} />}>
          <Route path="/" element={<ChainPreview {...props} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChainPreview', () => {
  it('renders nothing without a doc type or override', () => {
    const { container } = renderPreview({ chains, docType: '', overrideId: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('regression: matching chain + null eventType must not throw', () => {
    // The prod crash — null eventType used to detonate the opts destructure.
    renderPreview({ chains, docType: 'concept_paper', overrideId: null, eventType: null });
    expect(screen.getByText(/Will route through/)).toBeInTheDocument();
    expect(screen.getByText(/Standard Concept Paper/)).toBeInTheDocument();
  });

  it('filters gated steps by event type and flags', () => {
    renderPreview({ chains, docType: 'concept_paper', overrideId: null, eventType: 'seminar', flags: {} });
    expect(screen.getByText(/Org President/)).toBeInTheDocument();
    expect(screen.queryByText(/Intl desk/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Merch desk/)).not.toBeInTheDocument();
  });

  it('shows gated steps when their conditions hold', () => {
    renderPreview({
      chains, docType: 'concept_paper', overrideId: null,
      eventType: 'webinar_intl', flags: { has_merch: true },
    });
    expect(screen.getByText(/Intl desk/)).toBeInTheDocument();
    expect(screen.getByText(/Merch desk/)).toBeInTheDocument();
  });

  it('warns when no chain matches — owners get a fix link', () => {
    renderPreview({ chains, docType: 'unknown_type', overrideId: null }, { role: 'owner' });
    expect(screen.getByText(/No signatory chain matches/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add a chain in Settings/ })).toBeInTheDocument();
  });

  it('non-owners are pointed at an owner instead', () => {
    renderPreview({ chains, docType: 'unknown_type', overrideId: null }, { role: 'officer' });
    expect(screen.getByText(/Ask an owner to add one in Settings/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add a chain in Settings/ })).not.toBeInTheDocument();
  });

  it('honors a manual chain override', () => {
    renderPreview({ chains, docType: 'concept_paper', overrideId: 'c2' });
    expect(screen.getByText(/Using/)).toBeInTheDocument();
    expect(screen.getByText(/Letter route/)).toBeInTheDocument();
  });
});
