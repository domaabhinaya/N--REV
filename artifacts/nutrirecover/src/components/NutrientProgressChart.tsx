// Extracted from Dashboard so that recharts (~1.2 MB) is code-split out of
// the dashboard's initial render. Loaded via React.lazy only when the chart
// is actually displayed; the rendered markup is identical to the original
// inline <BarChart> block.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface WeeklyProgressPoint {
  date: string;
  protein: number;
  iron: number;
  calcium: number;
  vitaminD: number;
}

export default function NutrientProgressChart({ data }: { data: WeeklyProgressPoint[] }) {
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis />
          <RechartsTooltip />
          <Legend />
          <Bar dataKey="protein" fill="#3b82f6" name="Protein" />
          <Bar dataKey="iron" fill="#ef4444" name="Iron" />
          <Bar dataKey="calcium" fill="#10b981" name="Calcium" />
          <Bar dataKey="vitaminD" fill="#f59e0b" name="Vitamin D" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
