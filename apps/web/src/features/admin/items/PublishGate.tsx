import type { AuthoredItem } from '../../../lib/api/types.js';
import { Callout, Pill } from '../../../components/ui/Feedback.js';
import type { GateStatus } from './itemLint.js';
import '../admin.css';

interface GateRow {
  readonly label: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

/**
 * The publication gate checklist, straight from `author-item` in docs/skill.md.
 *
 * Rendered as derived state, never as ticks an operator can set. A checklist
 * you can tick yourself is a checklist that gets ticked; every row here is
 * computed from the item and the lint findings, so the only way to satisfy it
 * is to fix the item.
 */
export function PublishGate(props: {
  readonly item: AuthoredItem;
  readonly gate: GateStatus;
  readonly currentUserId: string;
}): JSX.Element {
  const { item, gate } = props;
  const blockedCodes = new Set(gate.blocking.map((f) => f.code));

  const rows: readonly GateRow[] = [
    {
      label: 'LaTeX validates strictly, server-side',
      satisfied: !blockedCodes.has('LATEX_INVALID'),
      detail: item.latexError ?? 'Validated on save. Cannot be bypassed.',
    },
    {
      label: 'Provenance set and not third-party uncleared',
      satisfied: !blockedCodes.has('PROVENANCE_UNCLEARED') && !blockedCodes.has('SOURCE_REF_MISSING'),
      detail: `${item.provenance}${item.sourceRef === '' ? '' : ` · ${item.sourceRef}`}`,
    },
    {
      label: 'Every option has a rationale',
      satisfied: !blockedCodes.has('RATIONALE_MISSING'),
      detail: 'Explaining why the distractor is wrong, not that it is.',
    },
    {
      label: 'Shuffle decision made deliberately, linter clean',
      satisfied: !blockedCodes.has('SHUFFLE_UNSAFE') && !blockedCodes.has('TYPE_NOT_SHUFFLABLE'),
      detail: item.shuffleOptions ? 'Shuffling on' : 'Shuffling off',
    },
    {
      label: 'Alt text and spoken text present',
      satisfied: !blockedCodes.has('A11Y_TEXT_MISSING'),
      detail: 'Required for every item, not only image-bearing ones.',
    },
    {
      label: 'Tagged to sub-topic',
      satisfied: !blockedCodes.has('TAXONOMY_MISSING'),
      detail: item.subTopicLabel ?? 'Not tagged',
    },
    {
      label: 'Approved by someone other than the author',
      satisfied: !gate.needsSecondApprover && props.currentUserId !== item.createdBy,
      detail:
        item.approvedBy === null
          ? 'Awaiting a second approver. Enforced as a database constraint, not by this screen.'
          : `Approved by ${item.approvedBy}`,
    },
    {
      label: 'Duplicate warnings reviewed',
      satisfied: item.duplicateWarnings.length === 0 || item.duplicatesAcknowledged,
      detail:
        item.duplicateWarnings.length === 0
          ? 'No near-duplicates found.'
          : `${item.duplicateWarnings.length} near-duplicate signals. Warnings never block.`,
    },
  ];

  return (
    <section className="gate card">
      <div className="row">
        <h3>Publication gate</h3>
        <div className="spacer" />
        <Pill tone={gate.ready ? 'success' : 'warning'}>
          {gate.ready ? 'Ready to publish' : `${gate.blocking.length} blocking`}
        </Pill>
      </div>

      <ul className="gate__list">
        {rows.map((row) => (
          <li key={row.label} className={`gate__row${row.satisfied ? ' gate__row--ok' : ''}`}>
            <span className="gate__marker" aria-hidden="true">
              {row.satisfied ? 'PASS' : 'HOLD'}
            </span>
            <span className="gate__label">
              {row.label}
              <span className="subtle"> {row.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {gate.warnings.length === 0 ? null : (
        <Callout tone="info" title="Warnings, not blockers">
          <ul className="gate__findings">
            {gate.warnings.map((finding) => (
              <li key={finding.code}>{finding.message}</li>
            ))}
          </ul>
        </Callout>
      )}

      {gate.blocking.length === 0 ? null : (
        <Callout tone="danger" title="These must be fixed before publication">
          <ul className="gate__findings">
            {gate.blocking.map((finding) => (
              <li key={`${finding.code}:${finding.field}`}>{finding.message}</li>
            ))}
          </ul>
        </Callout>
      )}
    </section>
  );
}
