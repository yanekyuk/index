import { getAllPosts } from '@/lib/blog';
import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Blog | Index Network',
  description: 'Insights and updates from Index Network',
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-4xl md:text-5xl font-garamond font-medium text-black mb-4">
        Blog
      </h1>
      <p className="text-lg text-black mb-12 font-sans">
        Insights, updates, and stories from Index Network
      </p>

      {posts.length === 0 ? (
        <p className="text-black font-ibm-plex-mono">No posts yet. Check back soon!</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <article key={post.slug}>
              <div className="flex gap-6">
                <time className="text-black italic shrink-0 w-28">
                  {new Date(post.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }).replace(',', '')}
                </time>
                <div className="flex-1">
                  <Link href={`/blog/${post.slug}`} className="text-blue-600 underline hover:text-blue-800">
                    {post.title}
                  </Link>
                  {post.description && (
                    <p className="text-gray-600 text-sm mt-1">
                      {post.description}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

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
