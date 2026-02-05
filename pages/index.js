import Head from 'next/head'
import styles from '../styles/Home.module.css'

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>Transkription WebApp</title>
        <meta name="description" content="Transkriptions-WebApp mit dynamischer Audio-Analyse" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          Willkommen bei der Transkription WebApp
        </h1>

        <p className={styles.description}>
          Eine moderne Webanwendung für Audio-Transkription und Analyse
        </p>

        <div className={styles.grid}>
          <a href="/upload" className={styles.card}>
            <h2>Audio hochladen &rarr;</h2>
            <p>Laden Sie Audio-Dateien für die Transkription hoch.</p>
          </a>

          <a href="/transcriptions" className={styles.card}>
            <h2>Transkriptionen &rarr;</h2>
            <p>Verwalten Sie Ihre Transkriptionen und Analysen.</p>
          </a>

          <a href="/settings" className={styles.card}>
            <h2>Einstellungen &rarr;</h2>
            <p>Konfigurieren Sie Ihre Benutzereinstellungen.</p>
          </a>
        </div>
      </main>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Transkription WebApp</p>
      </footer>
    </div>
  )
}