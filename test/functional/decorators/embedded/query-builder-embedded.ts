import "reflect-metadata";
import {setupTestingConnections, closeConnections, reloadDatabases} from "../../../utils/test-utils";
import {Connection} from "../../../../src/connection/Connection";
import {Post} from "./entity/Post";
import {Counters} from "./entity/Counters";

describe("decorators > embedded", () => {

    let connections: Connection[];
    beforeEach(() => setupTestingConnections({ entities: [Post, Counters], reloadAndCreateSchema: true }).then(all => connections = all));
    beforeEach(() => reloadDatabases(connections));
    afterEach(() => closeConnections(connections));

    describe("basic functionality", function() {

        it("should persist and load entities with embeddeds properly", () => Promise.all(connections.map(async connection => {
            const postRepository = connection.getRepository(Post);

            const post = new Post();
            post.title = "Hello post";
            post.text = "This is text about the post";
            post.counters = new Counters();
            post.counters.comments = 5;
            post.counters.favorites = 2;
            post.counters.likes = 1;

            await postRepository.persist(post);

            // now load it
            const loadedPost = await postRepository.findOneById(1);
            loadedPost.id.should.be.equal(1);
            loadedPost.title.should.be.equal("Hello post");
            loadedPost.text.should.be.equal("This is text about the post");
            loadedPost.counters.should.be.eql({
                comments: 5,
                favorites: 2,
                likes: 1
            });

        })));

        it("should be used with prop", () => Promise.all(connections.map(async connection => {
            const postRepository = connection.getRepository(Post);

            const post1 = new Post();
            post1.title = "Hello post #1";
            post1.text = "This is text about the post";
            post1.counters = new Counters();
            post1.counters.comments = 5;
            post1.counters.favorites = 2;
            post1.counters.likes = 1;

            await postRepository.persist(post1);

            const post2 = new Post();
            post2.title = "Hello post #2";
            post2.text = "This is text about the post";
            post2.counters = new Counters();
            post2.counters.comments = 6;
            post2.counters.favorites = 1;
            post2.counters.likes = 2;

            await postRepository.persist(post2);

            // now load it
            const sortedPosts1 = await postRepository
                .createQueryBuilder("post")
                .orderBy("post.counters.comments", "DESC")
                .getResults();

            sortedPosts1.should.be.eql([{
                id: 2,
                title: "Hello post #2",
                text: "This is text about the post",
                counters: {
                    comments: 6,
                    favorites: 1,
                    likes: 2
                }
            }, {
                id: 1,
                title: "Hello post #1",
                text: "This is text about the post",
                counters: {
                    comments: 5,
                    favorites: 2,
                    likes: 1
                }
            }]);

            // check another order
            const sortedPosts2 = await postRepository
                .createQueryBuilder("post")
                .orderBy("post.counters.favorites", "DESC")
                .getResults();

            sortedPosts2.should.be.eql([{
                id: 1,
                title: "Hello post #1",
                text: "This is text about the post",
                counters: {
                    comments: 5,
                    favorites: 2,
                    likes: 1
                }
            }, {
                id: 2,
                title: "Hello post #2",
                text: "This is text about the post",
                counters: {
                    comments: 6,
                    favorites: 1,
                    likes: 2
                }
            }]);

        })));

    });

});