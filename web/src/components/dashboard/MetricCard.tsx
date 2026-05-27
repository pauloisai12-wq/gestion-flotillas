interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: 'default' | 'green' | 'red' | 'yellow';
}

const colorMap = {
  default: 'border-l-gray-400',
  green: 'border-l-green-500',
  red: 'border-l-red-500',
  yellow: 'border-l-yellow-500',
};

export default function MetricCard({ title, value, subtitle, color = 'default' }: MetricCardProps) {
  return (
    <div className={"rounded-md border border-l-4 p-4 " + colorMap[color]}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
    </div>
  );
}