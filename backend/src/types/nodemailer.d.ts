declare module 'nodemailer' {
  export type TransportOptions = {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };

  export type SendMailOptions = {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  };

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export function createTransport(options: TransportOptions): Transporter;
}
