import { useEffect, useState } from "react";

export function Status() {
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setMe);
  });

  useEffect(() => {
    const id = setInterval(async () => {
      const res = await fetch("/api/status");
      setStatus(await res.json());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <pre>{JSON.stringify({ me, status })}</pre>;
}
