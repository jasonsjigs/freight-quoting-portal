import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function POST() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
  }

  try {
    const sql = neon(DATABASE_URL);
    
    // Create the quote_requests table
    await sql`
      CREATE TABLE IF NOT EXISTS quote_requests (
        id SERIAL PRIMARY KEY,
        raw_request TEXT NOT NULL,
        origin VARCHAR(255),
        destination VARCHAR(255),
        parcels JSONB,
        is_international BOOLEAN DEFAULT false,
        is_pallet BOOLEAN DEFAULT false,
        email VARCHAR(255),
        phone VARCHAR(50),
        quotes JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    // Create index for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_quote_requests_email ON quote_requests(email)
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS idx_quote_requests_created_at ON quote_requests(created_at)
    `;

    return NextResponse.json({ 
      success: true, 
      message: 'Database initialized successfully' 
    });
  } catch (error) {
    console.error('Database init error:', error);
    return NextResponse.json({ 
      error: 'Failed to initialize database',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: 'POST to this endpoint to initialize the database' 
  });
}
