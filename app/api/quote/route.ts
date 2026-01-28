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
const INTL_INDICATORS = ['china', 'shanghai', 'beijing', 'uk', 'london', 'germany', 'france', 'japan', 'tokyo', 'canada', 'mexico', 'india', 'australia', 'brazil', 'brasil', 'spain', 'espana', 'italy', 'netherlands', 'korea', 'vietnam', 'thailand', 'singapore', 'hong kong', 'taiwan', 'colombia', 'argentina', 'peru', 'chile', 'venezuela'];
const INCHES_PER_CM = 0.3937007874;
const POUNDS_PER_KG = 2.2046226218;
const DEFAULT_CONTACT_EMAIL = 'Jason@epmarine.com';
const DEFAULT_CONTACT_PHONE = '786-603-7883';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
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
  wyoming: 'WY',
  'puerto rico': 'PR'
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

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      if (!word) return '';
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function formatFreightosLocation(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) return trimmed;
  if (/\d/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^[A-Z]{3,5}$/.test(trimmed)) {
    return trimmed;
  }
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return trimmed;
  const city = toTitleCase(parts[0]);
  const rest = parts.slice(1).map((part) => normalizeState(part) || toTitleCase(part));
  return [city, ...rest].join(', ');
}

function extractStateAbbreviation(location: string): string | undefined {
  const match = location.match(/,\s*([A-Z]{2})\b/i);
  return match ? match[1].toUpperCase() : undefined;
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

async function geocodeCity(location: string): Promise<{ city?: string; state?: string; zip?: string; lat?: string; lon?: string } | null> {
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
      zip,
      lat: first.lat,
      lon: first.lon
    };
  } catch {
    return null;
  }
}

async function reverseGeocodeZip(lat: string, lon: string): Promise<string | null> {
  try {
    const url = `${NOMINATIM_REVERSE_URL}?format=json&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'freight-quoting-portal/1.0 (Jason@epmarine.com)',
        'Accept-Language': 'en',
        'Referer': 'https://freight-quoting-portal.vercel.app'
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const postcode = data?.address?.postcode;
    return postcode?.match(/\d{5}/)?.[0] || null;
  } catch {
    return null;
  }
}

async function lookupZipByCityState(city: string, state: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${state}/${encodeURIComponent(city)}`);
    if (!response.ok) return null;
    const data = await response.json();
    const place = data?.places?.[0];
    return place?.['post code'] || null;
  } catch {
    return null;
  }
}

async function resolveUsAddress(location: string): Promise<{ city: string; state: string; zip: string } | null> {
  const cacheKey = location.toLowerCase();
  const cached = LOCATION_CACHE.get(cacheKey);
  if (cached) return cached;

  const stateHint = normalizeState(extractStateAbbreviation(location));
  const zipFromInput = extractZip(location);
  if (zipFromInput) {
    const details = await lookupZipDetails(zipFromInput);
    const resolved = {
      city: details?.city || toTitleCase(location.split(',')[0] || ''),
      state: normalizeState(details?.state) || stateHint || '',
      zip: zipFromInput
    };
    if (resolved.city && resolved.state) {
      LOCATION_CACHE.set(cacheKey, resolved);
      return resolved;
    }
  }

  const geocoded = await geocodeCity(location);
  let zip = geocoded?.zip?.match(/\d{5}/)?.[0] || null;
  if (!zip && geocoded?.lat && geocoded?.lon) {
    zip = await reverseGeocodeZip(geocoded.lat, geocoded.lon);
  }

  const city = geocoded?.city || toTitleCase(location.split(',')[0] || '');
  const state = normalizeState(geocoded?.state) || stateHint || '';

  if (!zip && city && state) {
    zip = await lookupZipByCityState(city, state);
  }

  if (zip) {
    const details = await lookupZipDetails(zip);
    const resolved = {
      city: details?.city || city,
      state: normalizeState(details?.state) || state,
      zip
    };
    if (resolved.city && resolved.state) {
      LOCATION_CACHE.set(cacheKey, resolved);
      return resolved;
    }
  }

  return null;
}

async function buildShippoAddress(
  location: string,
  country: string
): Promise<{ city: string; state: string; zip: string; country: string } | null> {
  if (country !== 'US') {
    const geocoded = await geocodeCity(location);
    const zip = geocoded?.zip?.match(/\d{5}/)?.[0] || undefined;
    return {
      city: geocoded?.city || toTitleCase(location.split(',')[0] || ''),
      state: normalizeState(geocoded?.state) || '',
      zip: zip || '',
      country
    };
  }
  const resolved = await resolveUsAddress(location);
  if (!resolved) return null;
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
  if (normalized === 'cm' || normalized === 'cms' || normalized.startsWith('centimetro')) {
    return value * INCHES_PER_CM;
  }
  if (normalized === '"' || normalized === 'in' || normalized === 'inch' || normalized === 'inches' || normalized.startsWith('pulgada')) {
    return value;
  }
  return value;
}

function normalizeWeight(value: number, unit?: string): number {
  if (!unit) return value;
  const normalized = unit.toLowerCase();
  if (normalized === 'kg' || normalized === 'kgs' || normalized.startsWith('kilo') || normalized.startsWith('kilogramo')) {
    return value * POUNDS_PER_KG;
  }
  if (normalized === 'lb' || normalized === 'lbs' || normalized.startsWith('pound') || normalized.startsWith('libra')) {
    return value;
  }
  return value;
}

function parseNaturalLanguage(input: string): ParsedRequest {
  const normalizedInput = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const text = normalizedInput.toLowerCase();
  const parcels: Parcel[] = [];
  
  // Parse multiple boxes with various formats
  const dimSeparatorPattern = '(?:x|\\u00d7|\\*|by|por)';
  const dimUnitPattern = '(in\\.?|inch(?:es)?|cm|cms|centimetro(?:s)?|pulgada(?:s)?|")';
  const weightUnitPattern = '(lb|lbs|pound(?:s)?|libra(?:s)?|kg|kgs|kilo(?:s)?|kilogramo(?:s)?)';
  const boxPattern = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?\\s*${dimSeparatorPattern}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?\\s*${dimSeparatorPattern}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?\\s*(?:,|\\s)*(?:weighing\\s+|weight\\s+|weighs\\s+|peso\\s+|pesa\\s+|pesando\\s+)?(\\d+(?:\\.\\d+)?)(?:\\s*${weightUnitPattern})?`,
    'gi'
  );
  const dimOnlyPattern = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?\\s*${dimSeparatorPattern}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?\\s*${dimSeparatorPattern}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${dimUnitPattern})?`,
    'gi'
  );
  const weightPattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${weightUnitPattern}\\b`, 'gi');
  const weightWordPattern = new RegExp(`(?:weight|weighs|weighing|peso|pesa|pesando)\\s*(\\d+(?:\\.\\d+)?)(?:\\s*${weightUnitPattern})?`, 'i');
  const weightWordMatch = normalizedInput.match(weightWordPattern);
  const defaultWeight = weightWordMatch
    ? normalizeWeight(parseFloat(weightWordMatch[1]), weightWordMatch[2])
    : undefined;

  let matches = collectMatches(boxPattern, normalizedInput);
  
  if (matches.length > 0) {
    for (const match of matches) {
      parcels.push({
        length: normalizeLength(parseFloat(match[1]), match[2]),
        width: normalizeLength(parseFloat(match[3]), match[4]),
        height: normalizeLength(parseFloat(match[5]), match[6]),
        weight: normalizeWeight(parseFloat(match[7]), match[8])
      });
    }
  } else {
    const dimMatches = collectMatches(dimOnlyPattern, normalizedInput);
    const weightMatches = collectMatches(weightPattern, normalizedInput);
    
    for (let i = 0; i < dimMatches.length; i++) {
      const dim = dimMatches[i];
      const weightUnit = weightMatches[i]?.[2];
      const weight = weightMatches[i]
        ? normalizeWeight(parseFloat(weightMatches[i][1]), weightUnit)
        : defaultWeight ?? 10;
      parcels.push({
        length: normalizeLength(parseFloat(dim[1]), dim[2]),
        width: normalizeLength(parseFloat(dim[3]), dim[4]),
        height: normalizeLength(parseFloat(dim[5]), dim[6]),
        weight: weight
      });
    }
  }

  // Parse origin and destination
  const fromMatch = normalizedInput.match(/\b(?:from|desde|de)\s+([\w\s,.-]+?)(?:\s+(?:to|a|hasta)\s+|$)/i);
  const toMatch = normalizedInput.match(/\b(?:to|a|hasta)\s+([\w\s,.-]+?)(?:\s+(?:from|de|desde)|$|\.|\n)/i);
  
  let origin = '';
  let destination = '';
  
  const zipCodes = normalizedInput.match(/\b\d{5}(-\d{4})?\b/g) || [];
  
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

  if (!origin || !destination) {
    const stripped = normalizedInput
      .replace(boxPattern, ' ')
      .replace(dimOnlyPattern, ' ')
      .replace(weightPattern, ' ')
      .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
      .replace(/\b(ship|shipping|box|boxes|caja|cajas|paquete|paquetes|pallet|pallets|palet|palets|paleta|paletas|crate|crates|package|packages|parcel|parcels|freight|envio|enviar|weighing|weight|weighs|peso|pesa|pesando|lb|lbs|pound|pounds|libra|libras|kg|kgs|kilo|kilos|kilogramo|kilogramos|inch|inches|in|cm|cms|centimetro|centimetros|pulgada|pulgadas)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const simpleRoute = stripped.match(/(?:from|de|desde)?\s*(.+?)\s+(?:to|a|hasta)\s+(.+)/i);
    if (simpleRoute) {
      if (!origin) origin = simpleRoute[1].trim();
      if (!destination) destination = simpleRoute[2].trim();
    }
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
  if (/brazil|brasil|rio de janeiro|sao paulo/i.test(loc)) return 'BR';
  if (/puerto rico|san juan/i.test(loc)) return 'US';
  if (/spain|espana|madrid|barcelona/i.test(loc)) return 'ES';
  if (/colombia|bogota|medellin|cali/i.test(loc)) return 'CO';
  if (/argentina|buenos aires|cordoba|rosario/i.test(loc)) return 'AR';
  if (/peru|lima/i.test(loc)) return 'PE';
  if (/chile|santiago/i.test(loc)) return 'CL';
  if (/venezuela|caracas/i.test(loc)) return 'VE';
  
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
    const [originResolved, destinationResolved] = await Promise.all([
      buildShippoAddress(parsed.origin, parsed.originCountry),
      buildShippoAddress(parsed.destination, parsed.destCountry)
    ]);
    if (!originResolved || !destinationResolved) {
      console.log('Unable to resolve addresses for Shippo');
      return [];
    }

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
    const totalVolume = parsed.parcels.reduce((sum, p) => sum + (p.length * p.width * p.height), 0);
    const maxLength = Math.max(...parsed.parcels.map((p) => p.length));
    const maxWidth = Math.max(...parsed.parcels.map((p) => p.width));
    const maxHeight = Math.max(...parsed.parcels.map((p) => p.height));
    const loadType = parsed.isPallet ? 'pallets' : 'boxes';
    const freightosKey = process.env.FREIGHTOS_API_KEY;
    const isDomestic = parsed.originCountry === parsed.destCountry;
    const isFreight = parsed.isPallet || totalWeight > 150 || totalVolume > 50000;
    const allowAir = !(isDomestic && isFreight);
    const formatMeasure = (value: number, unit: string) => `${Math.round(value * 100) / 100}${unit}`;

    const params = new URLSearchParams({
      loadtype: loadType,
      origin: formatFreightosLocation(parsed.origin || '33142'),
      destination: formatFreightosLocation(parsed.destination || '90210'),
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
      const airModes = allowAir
        ? modes.filter((mode) => {
            const label = mode.mode?.toLowerCase();
            return label === 'air' || label === 'express';
          })
        : [];
      const freightModes = modes.filter((mode) => {
        const label = mode.mode?.toLowerCase();
        return label === 'lcl' || label === 'fcl' || label === 'sea' || label === 'ocean' || label === 'ltl' || label === 'ftl';
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

      if (allowAir) {
        buildCheapest(airModes, 'Air Freight', 'Air');
      }
      const freightLabel = isDomestic && isFreight ? 'Ground Freight' : 'Ocean Freight';
      const freightMode = isDomestic && isFreight ? 'Ground' : 'Ocean/LCL';
      buildCheapest(freightModes, freightLabel, freightMode);
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
      const baseGroundRate = 1.2;
      
      if (allowAir) {
        quotes.push({
          provider: 'Freightos',
          service: 'Air Freight (Estimate)',
          price: Math.round(weightKg * baseAirRate * 100) / 100,
          currency: 'USD',
          mode: 'Air',
          transitDays: '3-7 days'
        });
      }
      
      quotes.push({
        provider: 'Freightos',
        service: isDomestic && isFreight ? 'Ground Freight (Estimate)' : 'Ocean/LCL (Estimate)',
        price: Math.round(weightKg * (isDomestic && isFreight ? baseGroundRate : baseOceanRate) * 100) / 100,
        currency: 'USD',
        mode: isDomestic && isFreight ? 'Ground' : 'Ocean/LCL',
        transitDays: isDomestic && isFreight ? '2-7 days' : '15-30 days'
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
