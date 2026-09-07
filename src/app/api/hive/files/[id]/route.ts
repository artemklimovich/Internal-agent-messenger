import { requireUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const { id } = await context.params;
    const file = getStore().readFile(session.id, id);
    const safe = file.name.replace(/[^\w.\-а-яА-ЯёЁ ]+/g, "_");
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safe}"`,
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
