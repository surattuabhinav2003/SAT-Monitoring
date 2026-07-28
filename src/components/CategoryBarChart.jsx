import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import './ChartCard.css';

const GRID = '#ebebeb';
const AXIS = '#707070';

/**
 * Bar chart of application counts across a small set of categories.
 * Used for both the status breakdown and gstack implementation.
 *
 * @param {string} title     Card heading.
 * @param {string} subtitle  Supporting line under the heading.
 * @param {Array<{label:string, count:number}>} data
 * @param {string[]} colors  One colour per bar, in data order.
 */
export default function CategoryBarChart({ title, subtitle, data, colors }) {
  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="chart-card-body">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} />
            <YAxis stroke={AXIS} fontSize={12} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'rgba(1,41,172,0.06)' }}
              contentStyle={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
              {data.map((entry, index) => (
                <Cell key={entry.label} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
