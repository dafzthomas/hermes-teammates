import type { ReactNode } from 'react';
export type Editor = {
  title: string;
  body: ReactNode;
  submit: (data: FormData) => Promise<void>;
  button?: string;
};
