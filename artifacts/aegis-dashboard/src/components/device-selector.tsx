import { useDeviceContext } from "@/lib/device-context";
import { Monitor, Layers } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roleLabels: Record<string, string> = {
  ubuntu: "DEFENDER", honeypot: "HONEYPOT", router: "ROUTER", unknown: "UNKNOWN",
  "web-server": "WEB SERVER", "mail-server": "MAIL SERVER", workstation: "WORKSTATION", database: "DATABASE", forwarder: "FORWARDER",
};

/**
 * Global device selector, mounted in the header. Filters Network Monitor,
 * Defense Center, and System Status to a single connected device.
 * Kali (attacker) is excluded — it is never a monitorable "device".
 */
export function DeviceSelector() {
  const { devices, selectedIp, setSelectedIp, isLoading } = useDeviceContext();

  return (
    <Select
      value={selectedIp ?? "__all__"}
      onValueChange={v => setSelectedIp(v === "__all__" ? null : v)}
    >
      <SelectTrigger className="w-[220px] h-9 bg-card border-border text-sm font-mono">
        <div className="flex items-center gap-2 truncate">
          {selectedIp ? <Monitor className="w-3.5 h-3.5 text-cyan-400 shrink-0" /> : <Layers className="w-3.5 h-3.5 text-primary shrink-0" />}
          <SelectValue placeholder={isLoading ? "Loading devices…" : "All Devices"} />
        </div>
      </SelectTrigger>
      <SelectContent className="bg-card border-border">
        <SelectItem value="__all__">
          <span className="flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> All Devices</span>
        </SelectItem>
        {devices.map(d => (
          <SelectItem key={d.ip} value={d.ip}>
            <span className="flex items-center gap-2 font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${d.status === "online" ? "bg-green-400" : "bg-gray-500"}`} />
              {d.hostname} <span className="text-muted-foreground text-xs">({d.ip})</span>
              <span className="text-[10px] text-muted-foreground/70 uppercase">{roleLabels[d.role] ?? d.role}</span>
            </span>
          </SelectItem>
        ))}
        {devices.length === 0 && !isLoading && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No devices connected yet</div>
        )}
      </SelectContent>
    </Select>
  );
}
