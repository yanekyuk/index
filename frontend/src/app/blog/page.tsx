'use client';

import { BlogPost } from '@/lib/blog';
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    fetch('/api/blog/posts')
      .then(res => res.json())
      .then(data => setPosts(data));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-4xl md:text-5xl font-garamond font-medium text-black">
          Blog
        </h1>
        
        {/* Toggle Switch */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-black font-hanken">Images</span>
          <button
            onClick={() => setShowImages(!showImages)}
            className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${
              showImages ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
            }`}
            aria-pressed={showImages}
            aria-label="Toggle image view"
          >
            <span
              className={`absolute top-px left-px h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                showImages ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="text-black font-hanken">No posts yet. Check back soon!</p>
      ) : (
        <div className={showImages ? 'grid grid-cols-1 md:grid-cols-2 gap-6 mt-8' : 'space-y-4 mt-8'}>
          {posts.map((post) => (
            <article key={post.slug}>
              {showImages ? (
                // Card layout with image
                <Link href={`/blog/${post.slug}`} className="block group">
                  <div className="border border-gray-200 hover:border-gray-300 transition-colors">
                    {post.image && (
                      <div className="aspect-video w-full overflow-hidden bg-gray-100">
                        <Image
                          src={post.image}
                          alt={post.title}
                          width={400}
                          height={225}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    )}
                    <div className="p-4">
                      <time className="text-black italic text-sm font-hanken block mb-2">
                        {new Date(post.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        }).replace(',', '')}
                      </time>
                      <h2 className="text-black font-garamond text-lg font-medium group-hover:text-gray-700">
                        {post.title}
                      </h2>
                    </div>
                  </div>
                </Link>
              ) : (
                // List layout without image
                <div className="flex gap-3 items-center">
                  <time className="text-black italic shrink-0 w-28 text-sm font-hanken">
                    {new Date(post.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    }).replace(',', '')}
                  </time>
                  <div className="flex-1">
                    <Link href={`/blog/${post.slug}`} className="text-black font-garamond text-lg font-medium">
                      {post.title}
                    </Link>
                  </div>
                </div>
              )}
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
          <p className="text-sm text-gray-500 font-hanken">
            © {new Date().getFullYear()} Index Network
          </p>
        </div>
      </footer>
    </div>
  );
}
