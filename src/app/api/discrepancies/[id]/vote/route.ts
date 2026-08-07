import { NextResponse } from "next/server";

/** Voting removed — discrepancy solve is flagged only; majority (2:1) resolves other disagreements. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "voting disabled: use majority (2:1) for unflagged disagreements; discrepancy solve is not voted",
    },
    { status: 410 },
  );
}
