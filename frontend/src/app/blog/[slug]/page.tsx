import { getPostBySlug, getAllPostSlugs } from '@/lib/blog';
import { notFound } from 'next/navigation';
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
    description: post.description,
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
  img: ({ src, alt }) => {
    // Support size hints in alt text: ![alt|small](image.jpg)
    const [altText, size] = (alt || '').split('|').map(s => s.trim());
    const sizeClasses: Record<string, string> = {
      small: 'w-1/4',
      medium: 'w-1/2',
      large: 'w-3/4',
    };
    const widthClass = sizeClasses[size] || 'w-full';
    
    return (
      <img
        src={src}
        alt={altText}
        className={`${widthClass} rounded-lg my-6 mx-auto block`}
        loading="lazy"
      />
    );
  },
};

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col">
    <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
      {/* Post header */}
      <header className="mb-10 text-center">
        <time className="text-base text-black font-['Times_New_Roman',_serif]">
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
      <article className="text-black text-lg leading-[25px] font-['Times_New_Roman',_serif] [&_h2]:text-2xl [&_h2]:font-['Times_New_Roman',_serif] [&_h2]:font-medium [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-['Times_New_Roman',_serif] [&_h3]:font-medium [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:mb-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-6 [&_li]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:my-6">
        <ReactMarkdown components={markdownComponents}>{post.content}</ReactMarkdown>
      </article>

    </div>
    <Footer />
    </div>
  );
}
