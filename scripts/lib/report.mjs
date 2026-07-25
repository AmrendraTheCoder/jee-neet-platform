/**
 * Shared finding collection, output formatting and exit-code policy for every
 * CI gate in `scripts/`.
 *
 * Two output surfaces, deliberately:
 *
 * 1. `file:line:col LEVEL RULE message` on stdout, so a gate is equally usable
 *    from a terminal during development. A gate that only works inside CI gets
 *    run for the first time on the pull request, which is the worst moment.
 * 2. GitHub workflow-command annotations, so a finding lands on the exact line
 *    of the diff. Reviewers do not read job logs.
 */

import { appendFileSync } from 'node:fs';

const IS_GITHUB = process.env.GITHUB_ACTIONS === 'true';

/** Escape the property values of a GitHub workflow command. */
function escProp(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function escData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export class Report {
  /**
   * @param {string} gate short gate name, used in headings and annotations
   * @param {string} prevents one sentence: the failure this gate exists to stop
   */
  constructor(gate, prevents) {
    this.gate = gate;
    this.prevents = prevents;
    /** @type {Array<{level:'fail'|'warn'|'info',rule:string,file?:string,line?:number,col?:number,message:string,hint?:string}>} */
    this.findings = [];
    this.notes = [];
  }

  add(level, rule, message, where = {}, hint) {
    this.findings.push({
      level,
      rule,
      message,
      file: where.file,
      line: where.line,
      col: where.col,
      hint,
    });
  }

  fail(rule, message, where, hint) {
    this.add('fail', rule, message, where, hint);
  }

  warn(rule, message, where, hint) {
    this.add('warn', rule, message, where, hint);
  }

  info(rule, message, where, hint) {
    this.add('info', rule, message, where, hint);
  }

  note(line) {
    this.notes.push(line);
  }

  count(level) {
    return this.findings.filter((f) => f.level === level).length;
  }

  /** Print findings, emit annotations, write the job summary, return exit code. */
  finish({ summaryTable } = {}) {
    const order = { fail: 0, warn: 1, info: 2 };
    const sorted = [...this.findings].sort((a, b) => {
      if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
      if ((a.file ?? '') !== (b.file ?? '')) return (a.file ?? '').localeCompare(b.file ?? '');
      return (a.line ?? 0) - (b.line ?? 0);
    });

    process.stdout.write(`\n${this.gate}: ${this.prevents}\n\n`);

    for (const note of this.notes) process.stdout.write(`  ${note}\n`);
    if (this.notes.length) process.stdout.write('\n');

    for (const f of sorted) {
      const where = f.file ? `${f.file}:${f.line ?? 0}:${f.col ?? 0}` : '(repository)';
      process.stdout.write(`${where}  ${f.level.toUpperCase()}  ${f.rule}  ${f.message}\n`);
      if (f.hint) process.stdout.write(`${' '.repeat(2)}fix: ${f.hint}\n`);

      if (IS_GITHUB && f.level !== 'info') {
        const cmd = f.level === 'fail' ? 'error' : 'warning';
        const props = [`title=${escProp(`${this.gate}/${f.rule}`)}`];
        if (f.file) props.push(`file=${escProp(f.file)}`);
        if (f.line) props.push(`line=${f.line}`);
        if (f.col) props.push(`col=${f.col}`);
        const body = f.hint ? `${f.message} — fix: ${f.hint}` : f.message;
        process.stdout.write(`::${cmd} ${props.join(',')}::${escData(body)}\n`);
      }
    }

    const fails = this.count('fail');
    const warns = this.count('warn');
    process.stdout.write(`\n${fails} failure(s), ${warns} warning(s).\n`);

    writeSummary(this, sorted, summaryTable, fails, warns);

    return fails > 0 ? 1 : 0;
  }
}

function writeSummary(report, sorted, summaryTable, fails, warns) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = [
    `## ${report.gate}`,
    '',
    report.prevents,
    '',
    `**${fails} failure(s), ${warns} warning(s).**`,
    '',
  ];

  if (summaryTable && summaryTable.rows.length > 0) {
    lines.push(`| ${summaryTable.headers.join(' | ')} |`);
    lines.push(`| ${summaryTable.headers.map(() => '---').join(' | ')} |`);
    for (const row of summaryTable.rows) lines.push(`| ${row.join(' | ')} |`);
    lines.push('');
  }

  const notable = sorted.filter((f) => f.level !== 'info');
  if (notable.length > 0) {
    lines.push('| Level | Rule | Location | Finding |');
    lines.push('| --- | --- | --- | --- |');
    for (const f of notable) {
      const where = f.file ? `${f.file}:${f.line ?? 0}` : 'repository';
      lines.push(`| ${f.level} | \`${f.rule}\` | \`${where}\` | ${f.message} |`);
    }
    lines.push('');
  }

  // Appending rather than writing: several gates may share one job. This is
  // synchronous because the caller exits the process on the next line.
  appendFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

/** Assertion helper for the `--self-test` mode every gate exposes. */
export function selfTest(name, cases) {
  let failed = 0;
  for (const c of cases) {
    let ok = false;
    let detail = '';
    try {
      ok = c.assert();
    } catch (err) {
      detail = ` (threw: ${err instanceof Error ? err.message : String(err)})`;
    }
    process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${c.name}${detail}\n`);
    if (!ok) failed += 1;
  }
  process.stdout.write(
    `\n${name} self-test: ${cases.length - failed}/${cases.length} passed.\n`,
  );
  return failed > 0 ? 1 : 0;
}
