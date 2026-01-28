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

interface QuoteResult {
  provider: string;
  service: string;
  price: number;
  currency: string;
  transitDays?: string;
  mode?: string;
}

interface ShippoRate {
  provider: string;
  servicelevel?: { name?: string };
  servicelevel_name?: string;
  amount: string;
  currency: string;
  estimated_days?: number;
  duration_terms?: string;
}

interface FreightosRate {
  mode?: string;
  transportMode?: string;
  price?: number;
  totalPrice?: number;
  amount?: number;
  currency?: string;
  transitTime?: string;
  transit_time?: string;
  serviceName?: string;
  service?: string;
}

interface FreightosEstimateMode {
  mode?: string;
  price?: {
    min?: { moneyAmount?: { amount?: string | number; currency?: string } };
    max?: { moneyAmount?: { amount?: string | number; currency?: string } };
    moneyAmount?: { amount?: string | number; currency?: string };
  };
  transitTimes?: { min?: string | number; max?: string | number; unit?: string };
}

interface FreightosEstimateResponse {
  response?: {
    estimatedFreightRates?: {
      numQuotes?: string | number;
      mode?: FreightosEstimateMode | FreightosEstimateMode[];
    };
  };
}

// Country codes and detection
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;
const INTL_INDICATORS = ['china', 'shanghai', 'beijing', 'uk', 'london', 'germany', 'france', 'japan', 'tokyo', 'canada', 'mexico', 'india', 'australia', 'brazil', 'spain', 'italy', 'netherlands', 'korea', 'vietnam', 'thailand', 'singapore', 'hong kong', 'taiwan'];
const INCHES_PER_CM = 0.3937007874;
const POUNDS_PER_KG = 2.2046226218;
const DEFAULT_CONTACT_EMAIL = 'Jason@epmarine.com';
const DEFAULT_CONTACT_PHONE = '786-603-7883';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const LOCATION_CACHE = new Map<string, { city: string; state: string; zip: string }>();
const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY'
};
const DEFAULT_US_CITY_ZIPS: Record<string, { city: string; state: string; zip: string }> = {
  miami: { city: 'Miami', state: 'FL', zip: '33142' },
  tampa: { city: 'Tampa', state: 'FL', zip: '33602' },
  'los angeles': { city: 'Los Angeles', state: 'CA', zip: '90001' },
  'new york': { city: 'New York', state: 'NY', zip: '10001' },
  chicago: { city: 'Chicago', state: 'IL', zip: '60601' },
  houston: { city: 'Houston', state: 'TX', zip: '77002' },
  dallas: { city: 'Dallas', state: 'TX', zip: '75201' },
  atlanta: { city: 'Atlanta', state: 'GA', zip: '30301' },
  seattle: { city: 'Seattle', state: 'WA', zip: '98101' },
  boston: { city: 'Boston', state: 'MA', zip: '02108' },
  denver: { city: 'Denver', state: 'CO', zip: '80202' },
  orlando: { city: 'Orlando', state: 'FL', zip: '32801' },
  phoenix: { city: 'Phoenix', state: 'AZ', zip: '85004' },
  philadelphia: { city: 'Philadelphia', state: 'PA', zip: '19104' },
  'san francisco': { city: 'San Francisco', state: 'CA', zip: '94105' }
};

function extractZip(location: string): string | null {
  const match = location.match(/\b\d{5}(-\d{4})?\b/);
  if (!match) return null;
  return match[0].slice(0, 5);
}

function normalizeState(state?: string): string | undefined {
  if (!state) return undefined;
  const trimmed = state.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return US_STATE_ABBREVIATIONS[trimmed.toLowerCase()];
}

function extractStateAbbreviation(location: string): string | undefined {
  const match = location.match(/,\s*([A-Z]{2})\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function normalizeCityKey(location: string): string {
  return location
    .split(',')[0]
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
}

async function lookupZipDetails(zip: string): Promise<{ city: string; state: string } | null> {
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!response.ok) return null;
    const data = await response.json();
    const place = data?.places?.[0];
    if (!place) return null;
    return {
      city: place['place name'],
      state: place['state abbreviation']
    };
  } catch {
    return null;
  }
}

async function geocodeCity(location: string): Promise<{ city?: string; state?: string; zip?: string } | null> {
  const query = `${location}, USA`;
  try {
    const url = `${NOMINATIM_URL}?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'freight-quoting-portal/1.0 (Jason@epmarine.com)',
        'Accept-Language': 'en',
        'Referer': 'https://freight-quoting-portal.vercel.app'
      }
    });
    if (!response.ok) return null;
    const results = await response.json();
    const first = results?.[0];
    if (!first?.address) return null;
    const address = first.address;
    const zip = address.postcode?.match(/\d{5}/)?.[0];
    return {
      city: address.city || address.town || address.village || address.hamlet,
      state: address.state,
      zip
    };
  } catch {
    return null;
  }
}

async function resolveUsAddress(
  location: string,
  fallback: { city: string; state: string; zip: string }
): Promise<{ city: string; state: string; zip: string }> {
  const cacheKey = location.toLowerCase();
  const cached = LOCATION_CACHE.get(cacheKey);
  if (cached) return cached;

  const stateHint = normalizeState(extractStateAbbreviation(location));
  const zipFromInput = extractZip(location);
  if (zipFromInput) {
    const details = await lookupZipDetails(zipFromInput);
    const resolved = {
      city: details?.city || fallback.city,
      state: normalizeState(details?.state) || stateHint || fallback.state,
      zip: zipFromInput
    };
    LOCATION_CACHE.set(cacheKey, resolved);
    return resolved;
  }

  const cityKey = normalizeCityKey(location);
  const fallbackCity = DEFAULT_US_CITY_ZIPS[cityKey];
  const geocoded = await geocodeCity(location);
  const resolved = {
    city: geocoded?.city || fallbackCity?.city || fallback.city,
    state: normalizeState(geocoded?.state) || stateHint || fallbackCity?.state || fallback.state,
    zip: geocoded?.zip || fallbackCity?.zip || fallback.zip
  };
  LOCATION_CACHE.set(cacheKey, resolved);
  return resolved;
}

async function buildShippoAddress(
  location: string,
  country: string,
  fallback: { city: string; state: string; zip: string }
): Promise<{ city: string; state: string; zip: string; country: string }> {
  if (country !== 'US') {
    return {
      city: location.split(',')[0]?.trim() || fallback.city,
      state: fallback.state,
      zip: fallback.zip,
      country
    };
  }
  const resolved = await resolveUsAddress(location, fallback);
  return { ...resolved, country: 'US' };
}

function collectMatches(pattern: RegExp, input: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(input);
  while (match) {
    matches.push(match);
    match = pattern.exec(input);
  }
  return matches;
}

function normalizeLength(value: number, unit?: string): number {
  if (!unit) return value;
  const normalized = unit.toLowerCase();
  if (normalized === 'cm') {
    return value * INCHES_PER_CM;
  }
  return value;
}

function normalizeWeight(value: number, unit?: string): number {
  if (!unit) return value;
  const normalized = unit.toLowerCase();
  if (normalized === 'kg' || normalized === 'kgs') {
    return value * POUNDS_PER_KG;
  }
  return value;
}

function parseNaturalLanguage(input: string): ParsedRequest {
  const text = input.toLowerCase();
  const parcels: Parcel[] = [];
  
  // Parse multiple boxes with various formats
  const boxPattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*(in|inch|inches|cm|"))?\s*(?:,|\s)*(?:weighing\s+)?(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|kg|kgs)/gi;
  const dimOnlyPattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*(in|inch|inches|cm|"))?/gi;

  let matches = collectMatches(boxPattern, input);
  
  if (matches.length > 0) {
    for (const match of matches) {
      parcels.push({
        length: normalizeLength(parseFloat(match[1]), match[4]),
        width: normalizeLength(parseFloat(match[2]), match[4]),
        height: normalizeLength(parseFloat(match[3]), match[4]),
        weight: normalizeWeight(parseFloat(match[5]), match[6])
      });
    }
  } else {
    const dimMatches = collectMatches(dimOnlyPattern, input);
    const weightPattern = /(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|kg|kgs)/gi;
    const weightMatches = collectMatches(weightPattern, input);
    
    for (let i = 0; i < dimMatches.length; i++) {
      const dim = dimMatches[i];
      const weightUnit = weightMatches[i]?.[2];
      const weight = weightMatches[i] ? normalizeWeight(parseFloat(weightMatches[i][1]), weightUnit) : 10;
      const dimUnit = dim[4];
      parcels.push({
        length: normalizeLength(parseFloat(dim[1]), dimUnit),
        width: normalizeLength(parseFloat(dim[2]), dimUnit),
        height: normalizeLength(parseFloat(dim[3]), dimUnit),
        weight: weight
      });
    }
  }

  // Parse origin and destination
  const fromMatch = text.match(/from\s+([\w\s,]+?)(?:\s+to\s+|$)/i);
  const toMatch = text.match(/to\s+([\w\s,]+?)(?:\s+from|$|\.|\n)/i);
  
  let origin = '';
  let destination = '';
  
  const zipCodes = input.match(/\b\d{5}(-\d{4})?\b/g) || [];
  
  if (fromMatch) {
    origin = fromMatch[1].trim();
  } else if (zipCodes.length >= 1) {
    origin = zipCodes[0] || '';
  }
  
  if (toMatch) {
    destination = toMatch[1].trim();
  } else if (zipCodes.length >= 2) {
    destination = zipCodes[1] || '';
  }

  const originCountry = detectCountry(origin);
  const destCountry = detectCountry(destination);
  
  const isInternational = originCountry !== destCountry || 
    INTL_INDICATORS.some(ind => text.includes(ind));

  const isPallet = /pallet|freight|lcl|fcl|container/i.test(text);

  const totalWeight = parcels.reduce((sum, p) => sum + p.weight, 0);
  const totalVolume = parcels.reduce((sum, p) => sum + (p.length * p.width * p.height), 0);
  const multipleBoxes = parcels.length > 1;
  const heavyShipment = totalWeight > 150;
  const largeVolume = totalVolume > 50000;
  
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
  
  if (US_ZIP_REGEX.test(location) || 
      /\b(usa|us|united states|america)\b/i.test(loc) ||
      /\b(miami|los angeles|new york|chicago|houston|phoenix|philadelphia|san antonio|san diego|dallas|san jose|austin|jacksonville|fort worth|columbus|charlotte|seattle|denver|boston|detroit|nashville|portland|las vegas|memphis|louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|atlanta|kansas city|colorado springs|omaha|raleigh|virginia beach|oakland|minneapolis|tulsa|wichita|cleveland|tampa|orlando)\b/i.test(loc)) {
    return 'US';
  }
  
  if (/china|shanghai|beijing|shenzhen|guangzhou/i.test(loc)) return 'CN';
  if (/uk|united kingdom|london|manchester|birmingham|england|britain/i.test(loc)) return 'GB';
  if (/germany|berlin|munich|frankfurt|hamburg/i.test(loc)) return 'DE';
  if (/france|paris|lyon|marseille/i.test(loc)) return 'FR';
  if (/japan|tokyo|osaka|kyoto/i.test(loc)) return 'JP';
  if (/canada|toronto|vancouver|montreal|ottawa/i.test(loc)) return 'CA';
  if (/mexico|mexico city|guadalajara|cancun/i.test(loc)) return 'MX';
  if (/india|mumbai|delhi|bangalore/i.test(loc)) return 'IN';
  if (/australia|sydney|melbourne|brisbane/i.test(loc)) return 'AU';
  
  return 'US';
}

async function getShippoQuotes(
  parsed: ParsedRequest,
  contact?: { email?: string; phone?: string }
): Promise<QuoteResult[]> {
  const SHIPPO_API_KEY = process.env.SHIPPO_API_KEY;
  
  if (!SHIPPO_API_KEY) {
    console.log('Shippo API key not configured');
    return [];
  }

  try {
    const contactEmail = contact?.email || DEFAULT_CONTACT_EMAIL;
    const contactPhone = contact?.phone || DEFAULT_CONTACT_PHONE;
    const originFallback = DEFAULT_US_CITY_ZIPS[normalizeCityKey(parsed.origin)] || {
      city: 'Miami',
      state: 'FL',
      zip: '33142'
    };
    const destinationFallback = DEFAULT_US_CITY_ZIPS[normalizeCityKey(parsed.destination)] || {
      city: 'Los Angeles',
      state: 'CA',
      zip: '90210'
    };
    const [originResolved, destinationResolved] = await Promise.all([
      buildShippoAddress(parsed.origin, parsed.originCountry, originFallback),
      buildShippoAddress(parsed.destination, parsed.destCountry, destinationFallback)
    ]);

    const addressFrom = {
      name: 'Sender',
      street1: '123 Main St',
      city: originResolved.city,
      state: originResolved.state,
      zip: originResolved.zip,
      country: originResolved.country,
      email: contactEmail,
      phone: contactPhone,
      is_residential: false
    };

    const addressTo = {
      name: 'Recipient',
      street1: '456 Oak Ave',
      city: destinationResolved.city,
      state: destinationResolved.state,
      zip: destinationResolved.zip,
      country: destinationResolved.country,
      email: contactEmail,
      phone: contactPhone,
      is_residential: false
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
      return data.rates.map((rate: ShippoRate) => ({
        provider: rate.provider,
        service: rate.servicelevel?.name || rate.servicelevel_name || 'Standard',
        price: parseFloat(rate.amount),
        currency: rate.currency,
        transitDays: rate.estimated_days ? `${rate.estimated_days} days` : rate.duration_terms
      })).sort((a: QuoteResult, b: QuoteResult) => a.price - b.price);
    }
    
    return [];
  } catch (error) {
    console.error('Shippo error:', error);
    return [];
  }
}

async function getFreightosQuotes(parsed: ParsedRequest): Promise<QuoteResult[]> {
  try {
    const totalWeight = parsed.parcels.reduce((sum, p) => sum + p.weight, 0);
    const weightKg = Math.ceil(totalWeight * 0.453592);
    const parcelCount = Math.max(parsed.parcels.length, 1);
    const weightPerUnit = totalWeight / parcelCount;
    const maxLength = Math.max(...parsed.parcels.map((p) => p.length));
    const maxWidth = Math.max(...parsed.parcels.map((p) => p.width));
    const maxHeight = Math.max(...parsed.parcels.map((p) => p.height));
    const loadType = parsed.isPallet ? 'pallets' : 'boxes';
    const freightosKey = process.env.FREIGHTOS_API_KEY;
    const formatMeasure = (value: number, unit: string) => `${Math.round(value * 100) / 100}${unit}`;

    const params = new URLSearchParams({
      loadtype: loadType,
      origin: parsed.origin || '33142',
      destination: parsed.destination || '90210',
      weight: formatMeasure(weightPerUnit, 'lb'),
      width: formatMeasure(maxWidth, 'inch'),
      length: formatMeasure(maxLength, 'inch'),
      height: formatMeasure(maxHeight, 'inch'),
      quantity: String(parcelCount),
      format: 'json',
      resultSet: 'all',
      originType: 'Warehouse',
      destinationType: 'Warehouse',
      liftgate: 'false',
      loadingDock: 'false',
      customsBrokerage: 'false',
      knownShipper: 'false',
      insurance: 'false',
      goodsReady: 'true',
      value: '1000'
    });

    if (freightosKey) {
      params.set('key', freightosKey);
    }

    const url = `https://ship.freightos.com/api/shippingCalculator?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const data = (await response.json()) as FreightosEstimateResponse & { rates?: FreightosRate[]; results?: FreightosRate[] };
    
    const quotes: QuoteResult[] = [];
    const estimated = data.response?.estimatedFreightRates;
    const parseAmount = (amount?: string | number) => {
      if (amount === undefined || amount === null) return 0;
      return typeof amount === 'number' ? amount : parseFloat(amount);
    };
    const toTransitDays = (transit?: FreightosEstimateMode['transitTimes']) => {
      if (!transit) return undefined;
      if (transit.min && transit.max) {
        return `${transit.min}-${transit.max} ${transit.unit || 'days'}`;
      }
      if (transit.min) {
        return `${transit.min} ${transit.unit || 'days'}`;
      }
      return undefined;
    };

    if (estimated?.mode) {
      const modes = Array.isArray(estimated.mode) ? estimated.mode : [estimated.mode];
      const airModes = modes.filter((mode) => {
        const label = mode.mode?.toLowerCase();
        return label === 'air' || label === 'express';
      });
      const oceanModes = modes.filter((mode) => {
        const label = mode.mode?.toLowerCase();
        return label === 'lcl' || label === 'fcl' || label === 'sea' || label === 'ocean';
      });

      const buildCheapest = (modeList: FreightosEstimateMode[], label: string, fallbackMode: string) => {
        if (modeList.length === 0) return;
        const cheapest = modeList.reduce((min, mode) => {
          const price = parseAmount(mode.price?.min?.moneyAmount?.amount || mode.price?.moneyAmount?.amount);
          const minPrice = parseAmount(min.price?.min?.moneyAmount?.amount || min.price?.moneyAmount?.amount) || Number.POSITIVE_INFINITY;
          return price && price < minPrice ? mode : min;
        }, modeList[0]);
        const amount = parseAmount(cheapest.price?.min?.moneyAmount?.amount || cheapest.price?.moneyAmount?.amount);
        if (!amount) return;
        const currency = cheapest.price?.min?.moneyAmount?.currency || cheapest.price?.moneyAmount?.currency || 'USD';
        quotes.push({
          provider: 'Freightos',
          service: `${label} (Estimate)`,
          price: amount,
          currency,
          mode: fallbackMode,
          transitDays: toTransitDays(cheapest.transitTimes)
        });
      };

      buildCheapest(airModes, 'Air Freight', 'Air');
      buildCheapest(oceanModes, 'Ocean Freight', 'Ocean/LCL');
    }
    
    if (data.rates || data.results) {
      const rates: FreightosRate[] = data.rates || data.results || [];
      
      const airRates = rates.filter((r) => r.mode === 'air' || r.transportMode === 'AIR');
      const oceanRates = rates.filter((r) => r.mode === 'sea' || r.mode === 'ocean' || r.transportMode === 'SEA' || r.transportMode === 'LCL' || r.transportMode === 'FCL');
      
      if (airRates.length > 0) {
        const cheapestAir = airRates.reduce((min, r) => {
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
        const cheapestOcean = oceanRates.reduce((min, r) => {
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
      
      if (quotes.length === 0 && rates.length > 0) {
        return rates.slice(0, 5).map((r) => ({
          provider: 'Freightos',
          service: r.serviceName || r.service || 'Freight',
          price: r.price || r.totalPrice || r.amount || 0,
          currency: r.currency || 'USD',
          mode: r.mode || r.transportMode || 'Freight',
          transitDays: r.transitTime || r.transit_time || 'Varies'
        }));
      }
    }
    
    if (quotes.length === 0) {
      const baseAirRate = 3.5;
      const baseOceanRate = 0.8;
      
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
  quotes?: { shippo?: QuoteResult[]; freightos?: QuoteResult[] }
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
        raw_request, origin, destination, parcels, 
        is_international, is_pallet, email, phone, quotes, created_at
      ) VALUES (
        ${request}, ${parsed.origin}, ${parsed.destination},
        ${JSON.stringify(parsed.parcels)}, ${parsed.isInternational},
        ${parsed.isPallet}, ${email || null}, ${phone || null},
        ${JSON.stringify(quotes) || null}, NOW()
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
        parsed: { parcels: [], origin: '', destination: '', originCountry: 'US', destCountry: 'US', isInternational: false, isPallet: false, needsBothQuotes: false }
      }, { status: 400 });
    }

    const parsed = parseNaturalLanguage(request);

    const missingInfo: string[] = [];
    if (parsed.parcels.length === 0) missingInfo.push('dimensions');
    if (!parsed.origin) missingInfo.push('origin');
    if (!parsed.destination) missingInfo.push('destination');

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

    let routing = '';
    let shippoQuotes: QuoteResult[] = [];
    let freightosQuotes: QuoteResult[] = [];

    if (parsed.isPallet || (parsed.isInternational && !parsed.needsBothQuotes)) {
      routing = 'Freightos Only (Freight)';
      freightosQuotes = await getFreightosQuotes(parsed);
    } else if (!parsed.isInternational && parsed.parcels.length === 1 && parsed.parcels[0].weight < 70) {
      routing = 'Shippo Only (Domestic Parcel)';
      shippoQuotes = await getShippoQuotes(parsed, { email, phone });
    } else {
      routing = 'Both (Comparison)';
      [shippoQuotes, freightosQuotes] = await Promise.all([
        getShippoQuotes(parsed, { email, phone }),
        getFreightosQuotes(parsed)
      ]);
    }

    const allQuotes = [...shippoQuotes, ...freightosQuotes];

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
      parsed: { parcels: [], origin: '', destination: '', originCountry: 'US', destCountry: 'US', isInternational: false, isPallet: false, needsBothQuotes: false }
    }, { status: 500 });
  }
}
