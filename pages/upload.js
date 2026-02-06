import Head from 'next/head';
import { useState } from 'react';
import AudioUploadForm from '../components/AudioUploadForm';

export default function Upload() {
  const [success, setSuccess] = useState(null);

  function handleSuccess(result) {
    setSuccess('Audio-Datei wurde erfolgreich hochgeladen!');
    setTimeout(() => setSuccess(null), 5000);
  }

  return (
    <>
      <Head>
        <title>Audio hochladen - Transkription WebApp</title>
      </Head>

      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Audio hochladen
        </h1>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">
            {success}
          </div>
        )}

        <AudioUploadForm onSuccess={handleSuccess} />
      </div>
    </>
  );
}
