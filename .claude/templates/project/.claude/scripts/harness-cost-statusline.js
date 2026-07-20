#!/usr/bin/env node

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const model = data.model?.display_name || "Claude";
    const pct = Math.max(0, Math.min(100, Math.floor(data.context_window?.used_percentage || 0)));
    const cost = Number(data.cost?.total_cost_usd || 0);
    const effort = data.effort?.level || "default";
    const thinking = data.thinking?.enabled ? "thinking:on" : "thinking:off";
    const fiveHour = data.rate_limits?.five_hour?.used_percentage;
    const weekly = data.rate_limits?.seven_day?.used_percentage;
    const plan = [fiveHour, weekly].every(Number.isFinite)
      ? ` | limits 5h:${Math.floor(fiveHour)}% 7d:${Math.floor(weekly)}%`
      : "";
    const warning = pct >= 85 ? " | COMPACT/CLEAR SOON" : pct >= 70 ? " | context high" : "";
    process.stdout.write(`[${model}] context ${pct}% | session $${cost.toFixed(2)} | effort:${effort} ${thinking}${plan}${warning}\n`);
  } catch (error) {
    console.error(JSON.stringify({ event: "cost-status-unavailable", error: error.message }));
    process.stdout.write("[Claude] cost status unavailable\n");
  }
});
