import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

interface Parcel {
  length: number;
  width: number;
  height: number;
  weight: number;
}

interface ParsedRequest {
  parcels: Parcel[];
  origin: string;
  destination: string;
  originCountry: string;
  destCountry: string;
  isInternational: boolean;
  isPallet: boolean;
  needsBothQuotes: boolean;
}

// Country codes and detection
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;
const INTL_INDICATORS = ['china', 'shanghai', 'beijing', 'uk', 'london', 'germany', 'france', 'japan', 'tokyo', 'canada', 'mexico', 'india', 'australia', 'brazil', 'spain', 'italy', 'netherlands', 'korea', 'vietnam', 'thailand', 'singapore', 'hong kong', 'taiwan'];

function parseNaturalLanguage(input: string): ParsedRequest {
  const text = input.toLowerCase();
  const parcels: Parcel[] = [];
  
  // Parse multiple boxes with various formats
  // Format: "50x50x50 50lb" or "24x10x10 box weighing 20lbs"
  const boxPatterns = [
    // Pattern: dimensions weight (e.g., "50x50x50 50lb")
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|cm|")?\s*(?:,|\s)*(?:weighing\s+)?(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds|kg|kgs)/gi,
    // Pattern: dimensions then separate weight
    /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/gi
  ];

  // Try first pattern (dimensions + weight together)
  let matches = [...input.matchAll(boxPatterns[0])];
  
  if (matches.length > 0) {
    for (const match of matches) {
      parcels.push({
        length: parseFloat(match[1]),
        width: parseFloat(match[2]),
        height: parseFloat(match[3]),
        weight: parseFloat(match[4])
      });
    }
  } else {
    // Try to find dimensions and weights separately
    const dimMatches = [...input.matchAll(boxPatterns[1])];
    const weightMatches = [...input.matchAll(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds|kg|kgs)/gi)];
    
    for (let i = 0; i < dimMatches.length; i++) {
      const dim = dimMatches[i];
      const weight = weightMatches[i] ? parseFloat(weightMatches[i][1]) : 10; // default weight
      parcels.push({
        length: parseFloat(dim[1]),
        width: parseFloat(dim[2]),
        height: parseFloat(dim[3]),
        weight: weight
      });
    }
  }

  // Parse origin and destination
  const fromMatch = text.match(/from\s+([\w\s,]+?)(?:\s+to\s+|$)/i);
  const toMatch = text.match(/to\s+([\w\s,]+?)(?:\s+from|$|\.|\n)/i);
  
  let origin = '';
  let destination = '';
  
  // Also look for zip codes
  const zipCodes = input.match(/\b\d{5}(-\d{4})?\b/g) || [];
  
  if (fromMatch) {
    origin = fromMatch[1].trim();
  } else if (zipCodes.length >= 1) {
    origin = zipCodes[0];
  }
  
  if (toMatch) {
    destination = toMatch[1].trim();
  } else if (zipCodes.length >= 2) {
    destination = zipCodes[1];
  }

  // Detect countries
  const originCountry = detectCountry(origin);
  const destCountry = detectCountry(destination);
  
  // Determine if international
  const isInternational = originCountry !== destCountry || 
    INTL_INDICATORS.some(ind => text.includes(ind));

  // Detect pallet
  const isPallet = /pallet|freight|lcl|fcl|container/i.test(text);

  // Determine routing logic
  const totalWeight = parcels.reduce((sum, p) => sum + p.weight, 0);
  const totalVolume = parcels.reduce((sum, p) => sum + (p.length * p.width * p.height), 0);
  const multipleBoxes = parcels.length > 1;
  const heavyShipment = totalWeight > 150; // Over 150 lbs
  const largeVolume = totalVolume > 50000; // Large cubic inches
  
  // Needs both quotes in ambiguous cases:
  // - Multiple boxes (even domestic)
  // - International small parcels
  // - Heavy/large domestic shipments
  const needsBothQuotes = multipleBoxes || 
    (isInternational && !isPallet) || 
    heavyShipment || 
    largeVolume;

  return {
    parcels,
    origin,
    destination,
    originCountry,
    destCountry,
    isInternational,
    isPallet,
    needsBothQuotes
  };
}

function detectCountry(location: string): string {
  const loc = location.toLowerCase();
  
  // US indicators
  if (US_ZIP_REGEX.test(location) || 
      /\b(usa|us|united states|america)\b/i.test(loc) ||
      /\b(miami|los angeles|new york|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|charlotte|seattle|denver|boston|detroit|nashville|portland|las vegas|memphis|louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|atlanta|kansas city|colorado springs|omaha|raleigh|virginia beach|oakland|minneapolis|tulsa|wichita|cleveland|tampa|orlando)\b/i.test(loc)) {
    return 'US';
  }
  
  // Other countries
  if (/china|shanghai|beijing|shenzhen|guangzhou/i.test(loc)) return 'CN';
  if (/uk|united kingdom|london|manchester|birmingham|england|britain/i.test(loc)) return 'GB';
  if (/germany|berlin|munich|frankfurt|hamburg/i.test(loc)) return 'DE';
  if (/france|paris|lyon|marseille/i.test(loc)) return 'FR';
  if (/japan|tokyo|osaka|kyoto/i.test(loc)) return 'JP';
  if (/canada|toronto|vancouver|montreal|ottawa/i.test(loc)) return 'CA';
  if (/mexico|mexico city|guadalajara|cancun/i.test(loc)) return 'MX';
  if (/india|mumbai|delhi|bangalore/i.test(loc)) return 'IN';
  if (/australia|sydney|melbourne|brisbane/i.test(loc)) return 'AU';
  
  return 'US'; // Default to US
}

async function getShippoQuotes(parsed: ParsedRequest): Promise<any[]> {
  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  
  if (!SHIPPO_API_KEY) {
    console.log('Shippo API key not configured');
    return [];
  }

  try {
    // Build address objects - use zip codes or city names
    const addressFrom = {
      name: 'Sender',
      street1: '123 Main St',
      city: parsed.origin.match(/\d{5}/) ? 'City' : parsed.origin.split(',')[0] || 'Miami',
      state: 'FL',
      zip: parsed.origin.match(/\d{5}/)?.[0] || '33142',
      country: parsed.originCountry
    };

    const addressTo = {
      name: 'Recipient',
      street1: '456 Oak Ave',
      city: parsed.destination.match(/\d{5}/) ? 'City' : parsed.destination.split(',')[0] || 'Los Angeles',
      state: 'CA',
      zip: parsed.destination.match(/\d{5}/)?.[0] || '90210',
      country: parsed.destCountry
    };

    const parcels = parsed.parcels.map(p => ({
      length: String(p.length),
      width: String(p.width),
      height: String(p.height),
      distance_unit: 'in',
      weight: String(p.weight),
      mass_unit: 'lb'
    }));

    const response = await fetch('https://api.goshippo.com/shipments/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address_from: addressFrom,
        address_to: addressTo,
        parcels: parcels,
        async: false
      })
    });

    const data = await response.json();
    
    if (data.rates) {
      return data.rates.map((rate: any) => ({
        provider: rate.provider,
        service: rate.servicelevel?.name || rate.servicelevel_name || 'Standard',
        price: parseFloat(rate.amount),
        currency: rate.currency,
        transitDays: rate.estimated_days ? `${rate.estimated_days} days` : rate.duration_terms
      })).sort((a: any, b: any) => a.price - b.price);
    }
    
    return [];
  } catch (error) {
    console.error('Shippo error:', error);
    return [];
  }
}

async function getFreightosQuotes(parsed: ParsedRequest): Promise<any[]> {
  try {
    // Calculate total weight and volume for consolidated pallet quote
    const totalWeight = parsed.parcels.reduce((sum, p) => sum + p.weight, 0);
    const totalVolume = parsed.parcels.reduce((sum, p) => {
      // Convert cubic inches to CBM (1 CBM = 61023.7 cubic inches)
      return sum + (p.length * p.width * p.height) / 61023.7;
    }, 0);

    // Use Freightos public API
    const origin = encodeURIComponent(parsed.origin || '33142');
    const destination = encodeURIComponent(parsed.destination || '90210');
    const weightKg = Math.ceil(totalWeight * 0.453592); // Convert lbs to kg
    const volumeCbm = Math.max(0.01, totalVolume).toFixed(3);

    // Calculate dimensions in cm (estimate from volume)
    const dimCm = Math.ceil(Math.pow(totalVolume * 1000000, 1/3)); // cube root for equal dims
    
    const url = `https://ship.freightos.com/api/shippingCalculator?estimate=true&origin=${origin}&destination=${destination}&weight=${weightKg}kg&width=${dimCm}cm&length=${dimCm}cm&height=${dimCm}cm&quantity=1&format=json&resultSet=all`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    
    const quotes: any[] = [];
    
    if (data.rates || data.results) {
      const rates = data.rates || data.results || [];
      
      // Find cheapest air and cheapest ocean
      const airRates = rates.filter((r: any) => r.mode === 'air' || r.transportMode === 'AIR');
      const oceanRates = rates.filter((r: any) => r.mode === 'sea' || r.mode === 'ocean' || r.transportMode === 'SEA' || r.transportMode === 'LCL' || r.transportMode === 'FCL');
      
      if (airRates.length > 0) {
        const cheapestAir = airRates.reduce((min: any, r: any) => {
          const price = r.price || r.totalPrice || r.amount || 0;
          const minPrice = min.price || min.totalPrice || min.amount || Infinity;
          return price < minPrice ? r : min;
        });
        
        quotes.push({
          provider: 'Freightos',
          service: 'Air Freight (Cheapest)',
          price: cheapestAir.price || cheapestAir.totalPrice || cheapestAir.amount || 0,
          currency: cheapestAir.currency || 'USD',
          mode: 'Air',
          transitDays: cheapestAir.transitTime || cheapestAir.transit_time || 'Varies'
        });
      }
      
      if (oceanRates.length > 0) {
        const cheapestOcean = oceanRates.reduce((min: any, r: any) => {
          const price = r.price || r.totalPrice || r.amount || 0;
          const minPrice = min.price || min.totalPrice || min.amount || Infinity;
          return price < minPrice ? r : min;
        });
        
        quotes.push({
          provider: 'Freightos',
          service: 'Ocean Freight (Cheapest)',
          price: cheapestOcean.price || cheapestOcean.totalPrice || cheapestOcean.amount || 0,
          currency: cheapestOcean.currency || 'USD',
          mode: 'Ocean/LCL',
          transitDays: cheapestOcean.transitTime || cheapestOcean.transit_time || 'Varies'
        });
      }
      
      // If no categorized rates, return all sorted by price
      if (quotes.length === 0 && rates.length > 0) {
        return rates.slice(0, 5).map((r: any) => ({
          provider: 'Freightos',
          service: r.serviceName || r.service || 'Freight',
          price: r.price || r.totalPrice || r.amount || 0,
          currency: r.currency || 'USD',
          mode: r.mode || r.transportMode || 'Freight',
          transitDays: r.transitTime || r.transit_time || 'Varies'
        }));
      }
    }
    
    // Return estimate if no live rates
    if (quotes.length === 0) {
      // Calculate rough estimates based on weight/distance
      const baseAirRate = 3.5; // $/kg estimate
      const baseOceanRate = 0.8; // $/kg estimate
      
      quotes.push({
        provider: 'Freightos',
        service: 'Air Freight (Estimate)',
        price: Math.round(weightKg * baseAirRate * 100) / 100,
        currency: 'USD',
        mode: 'Air',
        transitDays: '3-7 days'
      });
      
      quotes.push({
        provider: 'Freightos',
        service: 'Ocean/LCL (Estimate)',
        price: Math.round(weightKg * baseOceanRate * 100) / 100,
        currency: 'USD',
        mode: 'Ocean/LCL',
        transitDays: '15-30 days'
      });
    }
    
    return quotes;
  } catch (error) {
    console.error('Freightos error:', error);
    return [];
  }
}

async function saveToDatabase(
  request: string, 
  parsed: ParsedRequest, 
  email?: string, 
  phone?: string,
  quotes?: any
) {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.log('Database not configured, skipping save');
    return;
  }

  try {
    const sql = neon(DATABASE_URL);
    
    await sql`
      INSERT INTO quote_requests (
        raw_request, 
        origin, 
        destination, 
        parcels, 
        is_international, 
        is_pallet,
        email,
        phone,
        quotes,
        created_at
      ) VALUES (
        ${request},
        ${parsed.origin},
        ${parsed.destination},
        ${JSON.stringify(parsed.parcels)},
        ${parsed.isInternational},
        ${parsed.isPallet},
        ${email || null},
        ${phone || null},
        ${JSON.stringify(quotes) || null},
        NOW()
      )
    `;
  } catch (error) {
    console.error('Database error:', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { request, email, phone } = body;

    if (!request || typeof request !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'Please provide a shipping request',
        quotes: [],
        routing: 'error',
        parsed: { parcels: [], origin: '', destination: '', isInternational: false, isPallet: false, needsBothQuotes: false }
      }, { status: 400 });
    }

    // Parse the natural language request
    const parsed = parseNaturalLanguage(request);

    // Check for missing info
    const missingInfo: string[] = [];
    if (parsed.parcels.length === 0) {
      missingInfo.push('dimensions');
    }
    if (!parsed.origin) {
      missingInfo.push('origin');
    }
    if (!parsed.destination) {
      missingInfo.push('destination');
    }

    if (missingInfo.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Missing information: ${missingInfo.join(', ')}. Please include package dimensions (LxWxH), weight, origin, and destination.`,
        quotes: [],
        routing: 'incomplete',
        parsed,
        missingInfo
      });
    }

    // Determine routing strategy
    let routing = '';
    let shippoQuotes: any[] = [];
    let freightosQuotes: any[] = [];

    if (parsed.isPallet || (parsed.isInternational && !parsed.needsBothQuotes)) {
      // Clear Freightos case: pallets or international freight
      routing = 'Freightos Only (Freight)';
      freightosQuotes = await getFreightosQuotes(parsed);
    } else if (!parsed.isInternational && parsed.parcels.length === 1 && parsed.parcels[0].weight < 70) {
      // Clear Shippo case: single small domestic parcel
      routing = 'Shippo Only (Domestic Parcel)';
      shippoQuotes = await getShippoQuotes(parsed);
    } else {
      // Ambiguous case: query both
      routing = 'Both (Comparison)';
      [shippoQuotes, freightosQuotes] = await Promise.all([
        getShippoQuotes(parsed),
        getFreightosQuotes(parsed)
      ]);
    }

    const allQuotes = [...shippoQuotes, ...freightosQuotes];

    // Save to database
    await saveToDatabase(request, parsed, email, phone, { shippo: shippoQuotes, freightos: freightosQuotes });

    return NextResponse.json({
      success: true,
      quotes: allQuotes,
      shippo: shippoQuotes,
      freightos: freightosQuotes,
      routing,
      parsed
    });

  } catch (error) {
    console.error('Quote API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process quote request',
      quotes: [],
      routing: 'error',
      parsed: { parcels: [], origin: '', destination: '', isInternational: false, isPallet: false, needsBothQuotes: false }
    }, { status: 500 });
  }
}
