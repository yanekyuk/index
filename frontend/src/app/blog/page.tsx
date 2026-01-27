'use client';

import { BlogPost } from '@/lib/blog';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import Footer from '@/components/Footer';

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);

  useEffect(() => {
    fetch('/api/blog/posts')
      .then(res => res.json())
      .then(data => setPosts(data));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
    <div className="max-w-3xl w-full mx-auto px-4 py-8 flex-1">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-garamond font-medium text-black">
          Letters from Index
        </h1>
      </div>

      {posts.length === 0 ? (
        <p className="text-black font-hanken">No posts yet. Check back soon!</p>
      ) : (
        <div className="space-y-2 mt-8">
          {posts.map((post) => (
            <article key={post.slug}>
              <div className="flex gap-2 items-center">
                <time className="text-black italic shrink-0 w-28 text-base font-hanken">
                  {new Date(post.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }).replace(',', '')}
                </time>
                <div className="flex-1">
                  <Link href={`/blog/${post.slug}`} className="text-black font-garamond text-lg font-bold underline">
                    {post.title}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

    </div>
    <Footer />
    </div>
  );
}
