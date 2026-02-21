import type { CardColor } from '../types';
import { COLOR_HEX } from './Card';

const COLORS: CardColor[] = ['yellow', 'blue', 'red'];

interface PeacockModalProps {
  onSelect: (color: CardColor) => void;
  onClose: () => void;
}

export default function PeacockModal({ onSelect, onClose }: PeacockModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>🦚 Choose a Color</h2>
        <p>Only this color (or another Peacock) can be played next.</p>
        <div className="modal-options">
          {COLORS.map(color => (
            <button
              key={color}
              className="modal-option modal-option--color"
              style={{ background: COLOR_HEX[color], color: color === 'yellow' ? '#7a6000' : '#fff' }}
              onClick={() => onSelect(color)}
            >
              {color.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
