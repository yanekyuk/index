import { getPostBySlug, getAllPostSlugs } from '@/lib/blog';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';

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

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Post header */}
      <header className="mb-10">
        <time className="text-sm text-black font-ibm-plex-mono">
          {new Date(post.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <h1 className="text-3xl md:text-4xl font-garamond font-medium text-black mt-3 mb-4 leading-tight">
          {post.title}
        </h1>
        {post.description && (
          <p className="text-lg text-black font-sans">
            {post.description}
          </p>
        )}
      </header>

      {/* Post content */}
      <article className="text-black leading-relaxed [&_h2]:text-2xl [&_h2]:font-garamond [&_h2]:font-medium [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-garamond [&_h3]:font-medium [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:mb-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-6 [&_li]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800 [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:my-6">
        <ReactMarkdown>{post.content}</ReactMarkdown>
      </article>

      {/* Footer */}
      <footer className="mt-16 pt-8 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Image
              src="/logo-black.svg"
              alt="Index Network"
              width={80}
              height={28}
              className="object-contain opacity-60 hover:opacity-100 transition-opacity"
            />
          </Link>
          <p className="text-sm text-gray-500 font-ibm-plex-mono">
            © {new Date().getFullYear()} Index Network
          </p>
        </div>
      </footer>
    </div>
  );
}
