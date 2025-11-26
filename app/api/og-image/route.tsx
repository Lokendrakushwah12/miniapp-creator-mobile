import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const appName = searchParams.get('name') || 'app name';

    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '80px',
            position: 'relative',
            background: 'linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Grid pattern background */}
          <div
            style={{
              display: 'block',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundImage: 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          {/* App Name - Large text on left, stacked vertically */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0px',
              zIndex: 1,
              marginTop: '40px',
            }}
          >
            {appName.split(' ').map((word, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  fontSize: '120px',
                  fontWeight: 'bold',
                  color: '#F5E6D3',
                  lineHeight: 1.1,
                  letterSpacing: '-0.03em',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {word}
              </div>
            ))}
          </div>

          {/* Made with badge - Top right */}
          <div
            style={{
              display: 'flex',
              position: 'absolute',
              top: '60px',
              right: '60px',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              background: 'white',
              borderRadius: '16px',
              padding: '20px 32px',
              zIndex: 2,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '11px',
                fontWeight: '600',
                color: '#6B46C1',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              MADE WITH
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '32px',
                fontWeight: 'bold',
                color: '#6B46C1',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>@</span>
              <span>minidev</span>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Failed to generate image', details: error instanceof Error ? error.message : String(error) }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
