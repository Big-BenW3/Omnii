"use client";

import Link from "next/link";
import useSWR from "swr";
import { api } from "../lib/client/api";
import { Card, Page, RequireSession } from "../lib/client/ui";

interface Row {
  id: string;
  name: string | null;
  status: string;
  scheduledStartAt: string;
  requestStatus?: string;
}

/** Where each meeting row should take the user next. */
function nextHref(r: Row, hosted: boolean) {
  if (hosted) {
    if (r.status === "DRAFT" || r.status === "SETUP_PENDING") return `/meeting/${r.id}/setup`;
    if (r.status === "LIVE") return `/meeting/${r.id}`;
    if (["ENDED", "EXPIRED", "FINALIZED"].includes(r.status)) return `/meeting/${r.id}/receipt`;
    return `/meeting/${r.id}/lobby`;
  }
  if (r.requestStatus === "PENDING_HOST_APPROVAL") return `/join/${r.id}`;
  return r.status === "LIVE" ? `/meeting/${r.id}` : `/meeting/${r.id}/lobby`;
}

export default function Dashboard() {
  return (
    <Page title="My meetings">
      <RequireSession>
        <List />
      </RequireSession>
    </Page>
  );
}

function List() {
  const { data, error } = useSWR<{ hosted: Row[]; joined: Row[] }>("/meetings", (p: string) => api(p), { refreshInterval: 5_000 });
  if (error) return <p className="text-danger">{(error as Error).message}</p>;
  if (!data) return <p>Loading…</p>;
  const row = (r: Row, hosted: boolean) => (
    <li key={r.id} className="border-b border-border py-2 text-sm" data-testid={hosted ? "hosted-meeting" : "joined-meeting"}>
      <Link className="underline" href={nextHref(r, hosted)}>{r.name ?? "Pending admission"}</Link>
      {" · "}{r.status}{r.requestStatus ? ` · ${r.requestStatus}` : ""} · {new Date(r.scheduledStartAt).toLocaleString()}
    </li>
  );
  return (
    <>
      <Card title="Hosting">
        {data.hosted.length === 0 ? <p className="text-sm">None yet. <Link className="underline" href="/create">Create a meeting</Link>.</p> : <ul>{data.hosted.map((r) => row(r, true))}</ul>}
      </Card>
      <Card title="Joined">
        {data.joined.length === 0 ? <p className="text-sm">None yet.</p> : <ul>{data.joined.map((r) => row(r, false))}</ul>}
      </Card>
    </>
  );
}
