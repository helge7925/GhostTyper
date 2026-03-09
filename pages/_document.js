import Document, { Head, Html, Main, NextScript } from 'next/document';

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
    return {
      ...initialProps,
      nonce: readNonce(ctx.req),
    };
  }

  render() {
    const nonce = this.props.nonce || undefined;

    return (
      <Html lang="de">
        <Head nonce={nonce} />
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default AppDocument;
