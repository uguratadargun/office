import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class joiner: clsx for conditionals, tailwind-merge so a caller's
 *  `className` actually WINS over a component's default instead of both landing
 *  in the list and the cascade deciding by source order. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
