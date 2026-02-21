import type { CardSymbol } from '../types';
import { SYMBOL_EMOJI } from './Card';

const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];

interface DragonModalProps {
  onSelect: (symbol: CardSymbol) => void;
  onClose: () => void;
}

export default function DragonModal({ onSelect, onClose }: DragonModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>🐉 Choose a Symbol</h2>
        <p>Only this symbol (or another Dragon) can be played next.</p>
        <div className="modal-options">
          {SYMBOLS.map(sym => (
            <button key={sym} className="modal-option" onClick={() => onSelect(sym)}>
              <span className="modal-option-emoji">{SYMBOL_EMOJI[sym]}</span>
              <span>{sym}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
