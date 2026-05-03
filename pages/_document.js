import Document, { Head, Html, Main, NextScript } from 'next/document';
import { THEME_INIT_SCRIPT } from '../lib/theme-context';
import { readLocaleFromCookie, DEFAULT_LOCALE } from '../lib/i18n';

function readNonce(req) {
  const nonceHeader = req?.headers?.['x-nonce'];
  if (Array.isArray(nonceHeader)) {
    return nonceHeader[0] || '';
  }
  return typeof nonceHeader === 'string' ? nonceHeader : '';
}

class AppDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    const cookie = ctx?.req?.headers?.cookie || '';
    const locale = readLocaleFromCookie(cookie) || DEFAULT_LOCALE;
    return {
      ...initialProps,
      nonce: readNonce(ctx.req),
      locale,
    };
  }

  render() {
    const nonce = this.props.nonce || undefined;
    const lang = this.props.locale || DEFAULT_LOCALE;

    return (
      <Html lang={lang}>
        <Head nonce={nonce} />
        <body>
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
          />
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default AppDocument;
