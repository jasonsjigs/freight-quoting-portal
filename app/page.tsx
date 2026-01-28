'use client';

import { useState } from 'react';

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

interface QuoteResponse {
  success: boolean;
  quotes: QuoteResult[];
  shippo?: QuoteResult[];
  freightos?: QuoteResult[];
  routing: string;
  parsed: ParsedRequest;
  missingInfo?: string[];
  error?: string;
}

export default function Home() {
  const [input, setInput] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuoteResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          request: input,
          email: email || undefined,
          phone: phone || undefined
        }),
      });

      const data: QuoteResponse = await response.json();
      setResult(data);
    } catch {
      setResult({ 
        success: false, 
        quotes: [], 
        routing: 'error',
        parsed: { parcels: [], origin: '', destination: '', isInternational: false, isPallet: false, needsBothQuotes: false },
        error: 'Failed to get quotes. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(price);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Freight Quoting Portal
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Get instant shipping quotes using natural language. Simply describe what you need to ship.
          </p>
        </div>

        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 shadow-2xl border border-slate-700">
            <label htmlFor="shipping-request" className="block text-slate-300 text-sm font-medium mb-3">
              Describe your shipment
            </label>
            <textarea
              id="shipping-request"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'Example: "Ship a 24x10x10 box weighing 20lbs from 33142 to 90210"\n\nOr multi-box: "I need to ship the following boxes:\n1- 50x50x50 50lb\n2- 50x10x10 10lb\n3- 50x10x10 10lb\nfrom Miami to Los Angeles"'}
              className="w-full h-40 px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={loading}
            />

            <div className="mt-6 p-4 bg-slate-900/40 border border-slate-700 rounded-xl">
              <p className="text-slate-300 text-sm mb-4">
                Contact info (optional for follow-up)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="email" className="block text-slate-300 text-sm mb-1">Email</label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="your@email.com"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-slate-300 text-sm mb-1">Phone (optional)</label>
                  <input
                    type="tel"
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
            </div>

            {result?.missingInfo?.length ? (
              <div className="mt-4 p-4 bg-amber-900/30 border border-amber-600/50 rounded-xl">
                <p className="text-amber-300 text-sm">
                  {result.error || 'Missing shipment details. Please add package dimensions, weight, origin, and destination.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.missingInfo.map((item) => (
                    <span key={item} className="px-2 py-1 bg-amber-500/20 text-amber-200 text-xs rounded-full">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="mt-6 w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-blue-500/25"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Getting Quotes...
                </span>
              ) : 'Get Quotes'}
            </button>
          </form>

          {result && !result.missingInfo?.length && (
            <div className="mt-8 bg-slate-800/50 backdrop-blur rounded-2xl p-8 shadow-2xl border border-slate-700">
              {result.error ? (
                <div className="text-red-400 text-center">
                  <p className="text-lg font-medium">Error</p>
                  <p className="text-sm mt-2">{result.error}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-white">Shipping Quotes</h2>
                    <span className="px-3 py-1 bg-blue-600/20 text-blue-400 text-sm rounded-full">
                      {result.routing}
                    </span>
                  </div>

                  {result.parsed && (
                    <div className="mb-6 p-4 bg-slate-900/50 rounded-xl">
                      <h3 className="text-slate-400 text-sm font-medium mb-2">Parsed Request</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-slate-500">From:</span>
                          <span className="text-white ml-2">{result.parsed.origin || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">To:</span>
                          <span className="text-white ml-2">{result.parsed.destination || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Parcels:</span>
                          <span className="text-white ml-2">{result.parsed.parcels?.length || 0}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Type:</span>
                          <span className="text-white ml-2">{result.parsed.isPallet ? 'Pallet' : 'Parcel'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {result.shippo && result.shippo.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        Shippo (Parcel Shipping)
                      </h3>
                      <div className="space-y-3">
                        {result.shippo.slice(0, 5).map((quote, index) => (
                          <div key={index} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl hover:bg-slate-900/70 transition-colors">
                            <div>
                              <p className="text-white font-medium">{quote.provider}</p>
                              <p className="text-slate-400 text-sm">{quote.service}</p>
                              {quote.transitDays && (
                                <p className="text-slate-500 text-xs mt-1">{quote.transitDays}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-green-400">
                                {formatPrice(quote.price, quote.currency)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {result.freightos && result.freightos.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                        Freightos (Freight Shipping)
                      </h3>
                      <div className="space-y-3">
                        {result.freightos.map((quote, index) => (
                          <div key={index} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl hover:bg-slate-900/70 transition-colors">
                            <div>
                              <p className="text-white font-medium">{quote.provider || 'Freightos'}</p>
                              <p className="text-slate-400 text-sm">{quote.service || quote.mode}</p>
                              {quote.transitDays && (
                                <p className="text-slate-500 text-xs mt-1">{quote.transitDays}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-purple-400">
                                {formatPrice(quote.price, quote.currency)}
                              </p>
                              {quote.mode && (
                                <p className="text-slate-500 text-xs">{quote.mode}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(!result.shippo || result.shippo.length === 0) && 
                   (!result.freightos || result.freightos.length === 0) && 
                   result.quotes && result.quotes.length > 0 && (
                    <div className="space-y-3">
                      {result.quotes.map((quote, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl">
                          <div>
                            <p className="text-white font-medium">{quote.provider}</p>
                            <p className="text-slate-400 text-sm">{quote.service}</p>
                          </div>
                          <p className="text-2xl font-bold text-green-400">
                            {formatPrice(quote.price, quote.currency)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {result.quotes?.length === 0 && !result.shippo?.length && !result.freightos?.length && (
                    <p className="text-slate-400 text-center py-8">
                      No quotes available for this shipment. Please check your input and try again.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <footer className="mt-16 text-center text-slate-500 text-sm">
          <p>Phase 1: Quotes Only | Booking functionality coming soon</p>
        </footer>
      </div>
    </main>
  );
}
