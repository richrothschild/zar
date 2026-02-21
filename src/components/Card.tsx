import type { Card as CardType, CardColor, CardSymbol } from '../types';

export const SYMBOL_EMOJI: Record<CardSymbol, string> = {
  galaxy: '🌌',
  moon: '🌙',
  cloud: '☁️',
  sun: '☀️',
  star: '⭐',
  lightning: '⚡',
};

export const COLOR_HEX: Record<CardColor, string> = {
  yellow: '#f5c518',
  blue: '#1e90ff',
  red: '#e63946',
};

export const COLOR_TEXT: Record<CardColor, string> = {
  yellow: '#7a6000',
  blue: '#ffffff',
  red: '#ffffff',
};

interface CardProps {
  card: CardType;
  onClick?: () => void;
  selected?: boolean;
  playable?: boolean;
  faceDown?: boolean;
  small?: boolean;
}

export default function Card({ card, onClick, selected, playable, faceDown, small }: CardProps) {
  if (faceDown) {
    return (
      <div
        className={`zar-card zar-card--back${small ? ' zar-card--small' : ''}`}
        onClick={onClick}
      >
        <span className="zar-card__back-logo">ZAR</span>
      </div>
    );
  }

  const bg = card.color ? COLOR_HEX[card.color] : '#2c2c54';
  const textColor = card.color ? COLOR_TEXT[card.color] : '#ffffff';

  let label = '';
  let sublabel = '';
  let emoji = '';

  if (card.kind === 'basic') {
    emoji = SYMBOL_EMOJI[card.symbol!];
    label = card.symbol!;
    sublabel = card.color!;
  } else if (card.kind === 'command') {
    if (card.command === 'wasp') { emoji = '🐝'; label = 'WASP'; sublabel = 'Draw 2'; }
    if (card.command === 'frog') { emoji = '🐸'; label = 'FROG'; sublabel = 'Skip'; }
    if (card.command === 'crab') { emoji = '🦀'; label = 'CRAB'; sublabel = 'Reverse'; }
  } else if (card.kind === 'power') {
    if (card.power === 'dragon') { emoji = '🐉'; label = 'DRAGON'; sublabel = 'Change Symbol'; }
    if (card.power === 'peacock') { emoji = '🦚'; label = 'PEACOCK'; sublabel = 'Change Color'; }
  }

  const classes = [
    'zar-card',
    selected ? 'zar-card--selected' : '',
    playable ? 'zar-card--playable' : '',
    onClick ? 'zar-card--clickable' : '',
    small ? 'zar-card--small' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{ background: bg, color: textColor, borderColor: selected ? '#fff' : 'rgba(0,0,0,0.3)' }}
      onClick={onClick}
      title={`${label} ${sublabel} (${card.points}pts)`}
    >
      <div className="zar-card__points">{card.points}</div>
      <div className="zar-card__emoji">{emoji}</div>
      {!small && (
        <>
          <div className="zar-card__label">{label}</div>
          <div className="zar-card__sublabel">{sublabel}</div>
        </>
      )}
    </div>
  );
}
