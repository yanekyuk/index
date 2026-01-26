import { getPostBySlug, getAllPostSlugs } from '@/lib/blog';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Components } from 'react-markdown';
import Footer from '@/components/Footer';

export async function generateStaticParams() {
  const slugs = getAllPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  
  if (!post) {
    return { title: 'Post Not Found | Index Network' };
  }

  return {
    title: `${post.title} | Index Network Blog`,
  };
}

function getAudioType(src: string): string {
  const ext = src.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    default:
      return 'audio/mpeg';
  }
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const childText = typeof children === 'string' ? children : 
      Array.isArray(children) ? children.join('') : '';
    
    // Check if this is an audio link: [audio](file.mp3)
    if (childText.toLowerCase() === 'audio' && href) {
      return (
        <div className="my-6">
          <audio
            controls
            className="w-1/2"
            preload="metadata"
          >
            <source src={href} type={getAudioType(href)} />
            Your browser does not support the audio element.
          </audio>
        </div>
      );
    }

    // Regular link
    return (
      <a href={href} className="text-blue-600 underline hover:text-blue-800">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ''}
      className="w-full rounded-lg my-6"
      loading="lazy"
    />
  ),
};

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col">
    <div className="max-w-3xl w-full mx-auto px-4 py-8 flex-1">
      {/* Back link */}
      <Link 
        href="/blog" 
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition-colors mb-6"
      >
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 16 16" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="stroke-current"
        >
          <path 
            d="M10 12L6 8L10 4" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
        </svg>
        Back to Blog
      </Link>

      {/* Post header */}
      <header className="mb-10 text-center">
        <time className="text-sm text-black font-ibm-plex-mono">
          {new Date(post.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <h1 className="text-3xl md:text-4xl font-garamond font-bold text-black mt-3 mb-4 leading-tight">
          {post.title}
        </h1>
      </header>

      {/* Post content */}
      <article className="text-black text-lg leading-relaxed [&_h2]:text-2xl [&_h2]:font-garamond [&_h2]:font-medium [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-garamond [&_h3]:font-medium [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:mb-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-6 [&_li]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:my-6">
        <ReactMarkdown components={markdownComponents}>{post.content}</ReactMarkdown>
      </article>

    </div>
    <Footer />
    </div>
  );
}
