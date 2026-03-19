export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, lineHeight: 1.6 }}>
      <h1>Discord Todo Bot</h1>
      <p>このデプロイは Discord interactions endpoint と Vercel cron 用です。</p>
      <p>health: /api/health</p>
      <p>interactions: /api/discord/interactions</p>
      <p>cron: /api/cron/daily-todo</p>
    </main>
  );
}
