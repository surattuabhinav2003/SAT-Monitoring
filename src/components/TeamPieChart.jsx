import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import './ChartCard.css';

// CloudFuze brand blues plus approved accent colours, ordered so adjacent
// slices stay distinguishable. Brand palette only — no violet.
const COLORS = [
  '#0129ac', // deep blue (primary)
  '#3fd6f1', // accent cyan
  '#0c18d4', // bright blue
  '#809efc', // light blue
  '#0065ff', // accent blue
  '#14cfc3', // accent teal
  '#011b73', // deep blue shade
  '#a7daff', // accent pale blue
];

// Pie starts at 12 o'clock and sweeps clockwise. The label geometry below
// assumes these exact values.
const START_ANGLE = 90;
const END_ANGLE = -270;

const INNER_RADIUS = 52;
const OUTER_RADIUS = 82;

const ELBOW_GAP = 12; // radial stub length beyond the arc
const ARM = 16; // horizontal arm after the elbow
const LABEL_PAD = 8; // text offset from the arm's end
const MIN_ROW = 34; // minimum vertical gap between two labels on a side

const RAD = Math.PI / 180;

/** Point on a circle, using Recharts' negated-angle convention (SVG y-down). */
function polar(cx, cy, radius, angleDeg) {
  return {
    x: cx + radius * Math.cos(-angleDeg * RAD),
    y: cy + radius * Math.sin(-angleDeg * RAD),
  };
}

/**
 * Push labels apart so they never overlap.
 *
 * Labels are laid out per side (left / right of the centre): sorted top-to-
 * bottom, spaced at least MIN_ROW apart, then shifted back as a block if that
 * pushed them past the top or bottom edge. This is what keeps the chart
 * readable when several teams have small, adjacent slices.
 */
function separate(items, top, bottom) {
  const rows = [...items].sort((a, b) => a.y - b.y);

  // First pass: cascade downward.
  for (let i = 1; i < rows.length; i += 1) {
    const gap = rows[i].y - rows[i - 1].y;
    if (gap < MIN_ROW) rows[i].y = rows[i - 1].y + MIN_ROW;
  }

  // If the stack overflowed the bottom, cascade back upward.
  const overflow = rows.length > 0 ? rows[rows.length - 1].y - bottom : 0;
  if (overflow > 0) {
    rows[rows.length - 1].y = bottom;
    for (let i = rows.length - 2; i >= 0; i -= 1) {
      const gap = rows[i + 1].y - rows[i].y;
      if (gap < MIN_ROW) rows[i].y = rows[i + 1].y - MIN_ROW;
    }
  }

  // Never let the first row sit above the top edge.
  if (rows.length > 0 && rows[0].y < top) {
    rows[0].y = top;
    for (let i = 1; i < rows.length; i += 1) {
      const gap = rows[i].y - rows[i - 1].y;
      if (gap < MIN_ROW) rows[i].y = rows[i - 1].y + MIN_ROW;
    }
  }

  return rows;
}

/**
 * Compute every label's leader line and text position in one pass.
 *
 * Done for the whole series at once (not per slice) because de-colliding
 * labels requires knowing where all of them want to sit.
 */
function buildLayout({ data, total, cx, cy, height }) {
  if (!total) return {};

  const sides = { left: [], right: [] };

  let cursor = START_ANGLE;
  const sweep = START_ANGLE - END_ANGLE; // 360

  data.forEach((entry, index) => {
    const slice = (entry.count / total) * sweep;
    const mid = cursor - slice / 2;
    cursor -= slice;

    const anchor = polar(cx, cy, OUTER_RADIUS, mid);
    const elbow = polar(cx, cy, OUTER_RADIUS + ELBOW_GAP, mid);
    const isRight = elbow.x >= cx;

    sides[isRight ? 'right' : 'left'].push({
      index,
      team: entry.team,
      count: entry.count,
      percent: entry.count / total,
      color: COLORS[index % COLORS.length],
      anchor,
      elbow,
      isRight,
      y: elbow.y,
    });
  });

  // Keep labels clear of the card's top and bottom edges.
  const top = 14;
  const bottom = height - 14;

  const byIndex = {};
  for (const side of ['left', 'right']) {
    separate(sides[side], top, bottom).forEach((row) => {
      byIndex[row.index] = row;
    });
  }
  return byIndex;
}

/**
 * Pie chart showing how applications are distributed across teams.
 *
 * Each slice is labelled with a leader line, so the team behind every slice is
 * readable at a glance without hovering.
 *
 * @param {Array<{team:string, count:number}>} data
 */
export default function TeamPieChart({ data }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const height = 340;

  if (total === 0) {
    return (
      <div className="chart-card">
        <div className="chart-card-header">
          <h3>Team-wise Application Usage</h3>
          <p>Applications grouped by the team using them</p>
        </div>
        <div className="chart-empty" style={{ height: height - 40 }}>
          <p>No applications yet — team usage will appear here.</p>
        </div>
      </div>
    );
  }

  // Cached per render pass: the label callback fires once per slice, but the
  // layout only depends on the chart box, so compute it at most once per box.
  let cache = null;
  function layoutFor(cx, cy) {
    const key = `${cx}|${cy}`;
    if (!cache || cache.key !== key) {
      cache = { key, value: buildLayout({ data, total, cx, cy, height }) };
    }
    return cache.value;
  }

  function renderLabel({ cx, cy, index }) {
    const item = layoutFor(cx, cy)[index];
    if (!item) return null;

    const { anchor, elbow, isRight, y, team, count, percent, color } = item;
    const armEnd = elbow.x + (isRight ? ARM : -ARM);
    const textX = armEnd + (isRight ? LABEL_PAD : -LABEL_PAD);
    const anchorAttr = isRight ? 'start' : 'end';

    return (
      <g key={`label-${index}`} className="pie-label">
        {/* Leader: radial stub from the arc, then a horizontal arm. */}
        <polyline
          points={`${anchor.x},${anchor.y} ${elbow.x},${elbow.y} ${armEnd},${y}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
        {/* Dot terminates the leader so the line doesn't just stop mid-air. */}
        <circle cx={armEnd} cy={y} r={2.6} fill={color} />

        <text
          x={textX}
          y={y - 4}
          textAnchor={anchorAttr}
          className="pie-label-team"
        >
          {team}
        </text>
        <text
          x={textX}
          y={y + 11}
          textAnchor={anchorAttr}
          className="pie-label-meta"
        >
          {count} {count === 1 ? 'app' : 'apps'} · {Math.round(percent * 100)}%
        </text>
      </g>
    );
  }

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3>Team-wise Application Usage</h3>
        <p>Applications grouped by the team using them</p>
      </div>
      <div className="chart-card-body">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={data}
              dataKey="count"
              nameKey="team"
              cx="50%"
              cy="50%"
              startAngle={START_ANGLE}
              endAngle={END_ANGLE}
              innerRadius={INNER_RADIUS}
              outerRadius={OUTER_RADIUS}
              paddingAngle={2}
              stroke="var(--bg-surface)"
              strokeWidth={2}
              label={renderLabel}
              labelLine={false}
              isAnimationActive={false}
            >
              {data.map((entry, index) => (
                <Cell key={entry.team} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            {/* Kept for exact values on hover — the labels already carry the
                team, count and share, so this is a bonus, not the only path. */}
            <Tooltip
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
