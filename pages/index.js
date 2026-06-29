import Link from 'next/link'

export default function Home() {
  return (
    <main style={{padding:20}}>
      <h1>Sales Visit System (PoC)</h1>
      <p>Next.js + Supabase starter.</p>
      <ul>
        <li><Link href="/admin">Admin Dashboard (placeholder)</Link></li>
        <li><Link href="/sales">Salesperson Portal (placeholder)</Link></li>
        <li><Link href="/login">Login</Link></li>
        <li><Link href="/super-admin">Super Admin (requires login)</Link></li>
      </ul>
    </main>
  )
}

export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/login',
      permanent: false,
    },
  };
}
