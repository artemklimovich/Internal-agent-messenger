export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "ошибка";
  const status =
    message === "unauthorized"
      ? 401
      : message === "forbidden" || message === "forbidden origin"
        ? 403
        : 400;
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request) {
  return (await request.json()) as T;
}
