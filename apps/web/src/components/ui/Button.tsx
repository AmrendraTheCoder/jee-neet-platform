import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'success';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly children: ReactNode;
}

/**
 * The only button in the product.
 *
 * `type="button"` by default rather than the HTML default of `submit`: the
 * attempt player's answer controls sit inside a form element for radio-group
 * semantics, and a Save & Next that accidentally submitted a form would
 * navigate away from a live paper.
 *
 * Height floors at the physical minimum target (FR-A11Y-02) and does not
 * shrink when text scales, because the target is a finger, not a glyph.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const { variant = 'primary', size = 'md', fullWidth = false, children, ...rest } = props;
  const classes = ['btn', `btn--${variant}`, `btn--${size}`];
  if (fullWidth) classes.push('btn--full');

  return (
    <button ref={ref} type="button" className={classes.join(' ')} {...rest}>
      {children}
    </button>
  );
});
