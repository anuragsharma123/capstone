import { ComingSoonIcon } from "../components/icons";

interface Props {
  title: string;
}

export default function ComingSoonPage({ title }: Props) {
  return (
    <div className="coming-soon">
      <ComingSoonIcon />
      <h2>{title}</h2>
      <p>This screen isn't built yet — MCP Registry is the only one live right now.</p>
    </div>
  );
}
