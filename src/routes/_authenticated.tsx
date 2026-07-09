import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Home, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) navigate({ to: "/auth" });
      else setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) navigate({ to: "/auth" });
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  const isHome = location.pathname === "/";
  const isChat = location.pathname.startsWith("/chat");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 pb-24">
        <Outlet />
      </div>
      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-card/90 backdrop-blur-lg">
        <div className="mx-auto max-w-lg grid grid-cols-2">
          <TabLink to="/" label="Home" active={isHome}>
            <Home className="h-5 w-5" strokeWidth={1.75} />
          </TabLink>
          <TabLink to="/chat" label="Talk" active={isChat}>
            <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
          </TabLink>
        </div>
      </nav>
    </div>
  );
}

function TabLink({ to, label, active, children }: { to: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className={`grid h-10 w-10 place-items-center rounded-2xl transition-colors ${active ? "bg-primary/10" : ""}`}>
        {children}
      </span>
      {label}
    </Link>
  );
}
