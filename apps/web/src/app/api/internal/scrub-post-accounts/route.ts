import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'MOVED_TO_SCHEDULER_SERVICE', message: 'Post-account scrubbing is owned by scheduler-service.' },
    { status: 410 },
  );
}
