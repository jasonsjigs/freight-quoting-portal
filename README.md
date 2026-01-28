# Freight Quoting Portal

A natural language freight quoting portal that accepts shipping requests in plain English and returns quotes from multiple carriers.

## Features

- **Natural Language Input**: Describe your shipment in plain English (e.g., "Ship a 24x10x10 box weighing 20lbs from 33142 to 90210")
- **Intelligent Routing**: Automatically routes to the appropriate API:
  - **Shippo**: Domestic parcels, small packages
  - **Freightos**: International freight, pallets, LCL/FCL
  - **Both**: Multi-box shipments, ambiguous cases for price comparison
- **Multi-Box Support**: Quote multiple packages in one request
- **Air & Ocean Options**: For freight, returns both cheapest air AND cheapest ocean quotes
- **Contact Collection**: Prompts for email/phone when needed for future label purchasing
- **Database Storage**: Stores all quote requests in Neon PostgreSQL

## Example Inputs

```
Ship a 24x10x10 box weighing 20lbs from 33142 to 90210

I need to ship the following boxes:
1- 50x50x50 50lb
2- 50x10x10 10lb
3- 50x10x10 10lb
from Miami to Los Angeles

Ship a pallet 48x40x48 500lbs from New York to London
```

## Tech Stack

- **Frontend**: Next.js 14 with React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Neon PostgreSQL (serverless)
- **APIs**: Shippo, Freightos
- **Deployment**: Vercel

## Environment Variables

```
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
SHIPPO_API_KEY=shippo_test_xxxxxxxxxxxxx
```

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your credentials
3. Run `npm install`
4. Initialize the database: `POST /api/init-db`
5. Run `npm run dev`

## Routing Logic

| Shipment Type | Origin | Destination | API Used |
|--------------|--------|-------------|----------|
| Single small box (<70 lbs) | US | US | Shippo only |
| Multiple boxes | US | US | Both (comparison) |
| Any pallet/freight | Any | Any | Freightos only |
| International parcel | US | International | Both (comparison) |
| Heavy shipment (>150 lbs) | Any | Any | Both (comparison) |

## Phase 1 (Current)

- Quote requests only
- No booking/label purchasing
- Contact info collection for future phases

## Coming in Phase 2

- Label purchasing
- Booking confirmation
- Shipment tracking
