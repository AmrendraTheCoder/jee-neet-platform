import { humanizeEnum } from '../../lib/format.js';
import { useAttemptController, useAttemptState } from './context.js';
import { currentSectionId, sectionNavigability } from './store/selectors.js';
import './attempt.css';

/**
 * Section tabs (FR-ATT-01).
 *
 * Free switching where the pattern permits it, which is the JEE Main and NEET
 * case and therefore the common one; lock enforcement where it does not. The
 * decision comes from `section.timeLocked` in the attempt snapshot — data on
 * the pattern, not a branch on the exam name (invariant 1). A 2027 pattern
 * that locks sections changes this behaviour with an INSERT.
 *
 * A locked-out tab is rendered DISABLED WITH A REASON rather than hidden. A
 * candidate who cannot find a section they know exists will spend paper time
 * hunting for it.
 */
export function SectionTabs(): JSX.Element {
  const controller = useAttemptController();
  const sections = useAttemptState((s) => s.snapshot.sections);
  const activeSectionId = useAttemptState((s) => currentSectionId(s));
  const navigability = useAttemptState(
    (s) => sectionNavigability(s),
    (a, b) => a.length === b.length && a.every((x, i) => x.enterable === b[i]?.enterable),
  );

  return (
    <div className="section-tabs" role="tablist" aria-label="Sections">
      {[...sections]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((section) => {
          const nav = navigability.find((n) => n.sectionId === section.sectionId);
          const enterable = nav?.enterable ?? false;
          const active = section.sectionId === activeSectionId;

          return (
            <button
              key={String(section.sectionId)}
              type="button"
              role="tab"
              className={`section-tab${active ? ' section-tab--active' : ''}`}
              aria-selected={active}
              disabled={!enterable && !active}
              title={nav?.reason ?? undefined}
              onClick={() => controller.enterSection(section.sectionId)}
            >
              <span className="section-tab__name">{section.name}</span>
              <span className="section-tab__subject">{humanizeEnum(section.subject)}</span>
              {section.timeLocked ? (
                <span className="section-tab__lock" aria-label="Separately timed section">
                  Timed separately
                </span>
              ) : null}
            </button>
          );
        })}
    </div>
  );
}
