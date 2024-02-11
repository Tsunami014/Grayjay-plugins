const URL_CLAIM_SEARCH = "https://api.na-backend.odysee.com/api/v1/proxy?m=claim_search"
const URL_RESOLVE = "https://api.na-backend.odysee.com/api/v1/proxy?m=resolve";
const URL_CONTENT = "https://odysee.com/\$/api/content/v2/get";
const URL_REACTIONS = "https://api.odysee.com/reaction/list";
const URL_VIEW_COUNT = "https://api.odysee.com/file/view_count";
const URL_USER_NEW = "https://api.odysee.com/user/new";
const URL_COMMENTS_LIST = "https://comments.odysee.tv/api/v2?m=comment.List";
const URL_BASE = "https://odysee.com";

const CLAIM_TYPE_STREAM = "stream";
const ORDER_BY_RELEASETIME = "release_time";
		
const REGEX_DETAILS_URL = new RegExp("lbry://(.*?)#(.*)");
const REGEX_CHANNEL_URL = /lbry:\/\/([^\/\n\r:#]+)(?::[0-9a-fA-F]+)?(?:#([0-9a-fA-F]+))?/;
const REGEX_CHANNEL_URL2 = /https:\/\/odysee.com\/([^\/\n\r:#]+)(?::[0-9a-fA-F]+)?(?:#([0-9a-fA-F]+))?/;

const PLATFORM = "Odysee";
const PLATFORM_CLAIMTYPE = 3;

var config = {};

//Source Methods
source.enable = function(conf){
	config = conf ?? {};
	//log(config);
}
source.getHome = function() {
	const contentData = getOdyseeContentData();
	const featured = contentData.categories["PRIMARY_CONTENT"];
	const query = {
		channel_ids: featured.channelIds,
        claim_type: featured.claimType,
        order_by: ["trending_group", "trending_mixed"],
        page: 1,
        page_size: 20,
        limit_claims_per_channel: 1
	};
	return getQueryPager(query);
};

source.searchSuggestions = function(query) {
	return [];
};
source.getSearchCapabilities = () => {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological, "^release_time"],
		filters: [
			{
				id: "date",
				name: "Date",
				isMultiSelect: false,
				filters: [
					{ id: Type.Date.Today, name: "Last 24 hours", value: "today" },
					{ id: Type.Date.LastWeek, name: "Last week", value: "thisweek" },
					{ id: Type.Date.LastMonth, name: "Last month", value: "thismonth" },
					{ id: Type.Date.LastYear, name: "Last year", value: "thisyear" }
				]
			},
		]
	};
};
source.search = function (query, type, order, filters) {
	let sort = order;
	if (sort === Type.Order.Chronological) {
		sort = "release_time";
	}

	let date = null;
	if (filters && filters["date"]) {
		date = filters["date"][0];
	}

	return getSearchPagerVideos(query, false, 0, null, sort, date);
};
source.getSearchChannelContentsCapabilities = function () {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: []
	};
};
source.searchChannelContents = function (channelUrl, query, type, order, filters) {
	let urlMatch = REGEX_CHANNEL_URL.exec(channelUrl);
	if (!urlMatch) {
		urlMatch = REGEX_CHANNEL_URL2.exec(channelUrl);
	}
	if (!urlMatch) {
		throw new ScriptException("Channel search not implemented for this URL type");
	}

	const channelId = urlMatch[2];
	if (!channelId) {
		const curl = `${URL_BASE}/${urlMatch[1]}`;
		const c = source.getChannel(curl);
		return getSearchPagerVideos(query, false, 0, c.id.value);
	}

	return getSearchPagerVideos(query, false, 0, channelId);
};

source.searchChannels = function (query) {
	return getSearchPagerChannels(query, false);
};

//Channel
source.isChannelUrl = function(url) {
	return REGEX_CHANNEL_URL.test(url) || REGEX_CHANNEL_URL2.test(url);
};
source.getChannel = function (url) {
	const urlMatch = REGEX_CHANNEL_URL2.exec(url);
	if (urlMatch) {
		url = "lbry://" + urlMatch[1];
    }

	let channels = resolveClaimsChannel([url]);
	const channel = channels[0];
	channel.subscribers = getChannelSubCount(channel.url);
	return channel;
};
source.getChannelContents = function (url) {
	let urlMatch = REGEX_CHANNEL_URL.exec(url);
	if (!urlMatch) {
		urlMatch = REGEX_CHANNEL_URL2.exec(url);
	}
	if (!urlMatch) {
		throw new ScriptException("Channel search not implemented for this URL type");
	}

	let channelId = urlMatch[2];
	if (!channelId) {
		const curl = `${URL_BASE}/${urlMatch[1]}`;
		const c = source.getChannel(curl);
		channelId = c.id.value;
	}

	return getQueryPager({
		channel_ids: [channelId],
		page: 1,
		page_size: 8,
		claim_type: [CLAIM_TYPE_STREAM],
		order_by: [ORDER_BY_RELEASETIME]
	});
};

source.getChannelTemplateByClaimMap = () => {
    return {
        //Odysee
        3: {
			0: "lbry://{{CLAIMVALUE}}"
			//Unused! 1: claim id
        }
    };
};

//Video
source.isContentDetailsUrl = function(url) {
	return REGEX_DETAILS_URL.test(url)
};
source.getContentDetails = function(url) {
	return resolveClaimsVideoDetail([url])[0];
};

source.getComments = function (url) {
	const videoId = url.split('#')[1];
	return getCommentsPager(url, videoId, 1, true);

}
source.getSubComments = function (comment) {
	if (typeof comment === 'string') {
		comment = JSON.parse(comment);
	}

	return getCommentsPager(comment.contextUrl, comment.context.claimId, 1, false, comment.context.commentId);
}

function getCommentsPager(contextUrl, claimId, page, topLevel, parentId = null) {
	const body = JSON.stringify({
		"jsonrpc": "2.0",
		"id": 1,
		"method": "comment.List",
		"params": {
			"page": page,
			"claim_id": claimId,
			"page_size": 10,
			"top_level": topLevel,
			"sort_by": 3,
			... (parentId ? { "parent_id": parentId } : { })
		}
	});
	
	const resp = http.POST(URL_COMMENTS_LIST, body, {
		"Content-Type": "application/json" 
	});

	if (!resp.isOk) {
		return new CommentPager([], false, {});
	}

	const result = JSON.parse(resp.body);

	//Make optional thumbnail map
	let claimsToQuery = result.result?.items?.map(i => i.channel_id) ?? [];
	claimsToQuery = [...new Set(claimsToQuery)]; //Deduplicate list
	const claimsResp = http.POST(URL_CLAIM_SEARCH, JSON.stringify({
		"jsonrpc": "2.0",
		method: "claim_search",
		params: {
			claim_ids: claimsToQuery,
			no_totals: true,
			page: 1,
			page_size: 20
		}
	}), {
		"Content-Type": "application/json" 
	});

	const thumbnailMap = {};
	const claimsResItems = JSON.parse(claimsResp.body)?.result?.items;
	if (claimsResp.isOk && claimsResItems) {
		for (const i of claimsResItems) {
			const url = i.value?.thumbnail?.url;
			if (url) {
				thumbnailMap[i.claim_id] = url;
			}
		}
	}

	//Map comments
	const comments = result.result?.items?.map(i => {
		const c = new Comment({
			contextUrl: contextUrl,
			author: new PlatformAuthorLink(new PlatformID(PLATFORM, i.channel_id, config.id, PLATFORM_CLAIMTYPE),
				i.channel_name ?? "",
				i.channel_url,
				thumbnailMap[i.channel_id] ?? ""),
			message: i.comment ?? "",
			date: i.timestamp,
			replyCount: i.replies,
			context: { claimId: i.claim_id, commentId: i.comment_id }
		});

		return c;
	}) ?? [];

	const hasMore = result.result.page < result.result.total_pages;
	return new OdyseeCommentPager(comments, hasMore, { claimId, page, topLevel, parentId });
}
		
//Internals
function getOdyseeContentData() {
	const resp = http.GET(URL_CONTENT, {});
	if(!resp.isOk)
	    throw new ScriptException("Failed request [" + URL_CONTENT + "] (" + resp.code + ")");
	const contentResp = JSON.parse(resp.body);
	
	return contentResp.data["en"];
}
function getQueryPager(query) {
	const initialResults = claimSearch(query);
	return new QueryPager(query, initialResults);
}
function getSearchPagerVideos(query, nsfw = false, maxRetry = 0, channelId = null, sortBy = null, timeFilter = null) {
	const pageSize = 10;
	const results = searchAndResolveVideos(query, 0, pageSize, nsfw, maxRetry, channelId, sortBy, timeFilter);
	return new SearchPagerVideos(query, results, pageSize, nsfw, channelId, sortBy, timeFilter);
}
function getSearchPagerChannels(query, nsfw = false) {
	const pageSize = 10;
	const results = searchAndResolveChannels(query, 0, pageSize, nsfw).map(x=>channelToAuthorLink(x));
	return new SearchPagerChannels(query, results, pageSize, nsfw);
}

function getChannelSubCount(url) {
	return 0;
}

//Pagers
class QueryPager extends VideoPager {
	constructor(query, results) {
		super(results, results.length >= query.page_size, query);
	}
	
	nextPage() {
		this.context.page = this.context.page + 1;
		return getQueryPager(this.context);
	}
}
class SearchPagerVideos extends VideoPager {
	constructor(searchStr, results, pageSize, nsfw = false, channelId = null, sortBy = null, timeFilter = null) {
		super(results, results.length >= pageSize, {
			query: searchStr,
			page_size: pageSize,
			nsfw: nsfw,
			page: 0,
			channelId,
			sortBy,
			timeFilter
		});
	}
	
	nextPage() {
		this.context.page = this.context.page + 1;
		const start = (this.context.page - 1) * this.context.page_size;
		const end = (this.context.page) * this.context.page_size;
		
		this.results = searchAndResolveVideos(this.context.query, start, this.context.page_size, this.context.nsfw, 5, this.context.channelId, this.context.sortBy, this.context.timeFilter);
		if(this.results.length == 0)
		    this.hasMore = false;
		
		return this;
	}
}
class SearchPagerChannels extends ChannelPager {
	constructor(searchStr, results, pageSize, nsfw = false) {
		super(results, results.length >= pageSize, {
			query: searchStr,
			page_size: pageSize,
			nsfw: nsfw,
			page: 0
		});
	}

	nextPage() {
		this.context.page = this.context.page + 1;
		const start = (this.context.page - 1) * this.context.page_size;
		const end = (this.context.page) * this.context.page_size;

		this.results = searchAndResolveChannels(this.context.query, start, this.context.page_size, this.nsfw)
		    .map(x=>channelToAuthorLink(x));
		if(this.results.length == 0)
		    this.hasMore = false;

		return this;
	}
}

class OdyseeCommentPager extends CommentPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}

	nextPage() {
		return getCommentsPager(this.context.contextUrl, this.context.claimId, this.context.page + 1, this.context.topLevel, this.context.parentId);
	}
}

//Internal methods
function searchAndResolveVideos(search, from, size, nsfw = false, maxRetry = 0, channelId = null, sortBy = null, timeFilter = null) {
    const claimUrls = searchClaims(search, from, size, "file", nsfw, maxRetry, 0, channelId, sortBy, timeFilter);
    return resolveClaimsVideo(claimUrls);
}
function searchAndResolveChannels(search, from, size, nsfw = false) {
    const claimUrls = searchClaims(search, from, size, "channel", nsfw);
    return resolveClaimsChannel(claimUrls);
}
function searchClaims(search, from, size, type = "file", nsfw = false, maxRetry = 0, ittRetry = 0, channelId = null, sortBy = null, timeFilter = null) {
	let url = "https://lighthouse.odysee.tv/search?s=" + encodeURIComponent(search) +
            "&from=" + from + "&size=" + size + "&nsfw=" + nsfw;// + "&claimType=file&mediaType=video"
			
	if(type == "file")
	    url += "&claimType=file&mediaType=video";
	else
		url += "&claimType=" + type;
	
	if (channelId) {
		url += "&channel_id=" + channelId;
	}

	if (sortBy) {
		url += "&sort_by=" + sortBy;
	}

	if (timeFilter) {
		url += "&time_filter=" + timeFilter;
	}

	log(url);

	const respSearch = http.GET(url, {});
	
	if(respSearch.code >= 300) {
	    if(respSearch.body && respSearch.body.indexOf("1020") > 0) {
	        if(ittRetry < maxRetry) {
	            log("Retry searchClaims [" + ittRetry + "]");
	            return searchClaims(search, from, size, type, nsfw, maxRetry, ittRetry + 1);
	        }
	        else {
	            log("Retrying searchClaims failed after " + ittRetry + " attempts");
	            return [];
	        }
	    }

        if(respSearch.code == 408) {
            log("Odysee failed with timeout after retries");
            return [];
        }
        else
		    throw new ScriptException("Failed to search with code " + respSearch.code + "\n" + respSearch.body);
    }
	if(respSearch.body == null || respSearch.body == "") {
		throw new ScriptException("Failed to search with code " + respSearch.code + " due to empty body")
	}
	
	const claims = JSON.parse(respSearch.body);
	const claimUrls = claims.map(x=>x.name + "#" + x.claimId);
	return claimUrls;
}

function claimSearch(query) {
	const body = JSON.stringify({
		method: "claim_search",
		params: query
	});
	const resp = http.POST(URL_CLAIM_SEARCH, body, {
		"Content-Type": "application/json" 
	});
	if(resp.code >= 300)
		throw "Failed to search claims\n" + resp.body;
	const result = JSON.parse(resp.body);
	return result.result.items.map((x)=> lbryVideoToPlatformVideo(x));
}

function resolveClaimsChannel(claims) {
    if(!claims || claims.length == 0)
        return [];
	const results = resolveClaims(claims);
	return results.map(x=>lbryChannelToPlatformChannel(x));
}
function resolveClaimsVideo(claims) {
    if(!claims || claims.length == 0)
        return [];
	const results = resolveClaims(claims);
	return results.map(x=>lbryVideoToPlatformVideo(x));
}
function resolveClaimsVideoDetail(claims) {
    if(!claims || claims.length == 0)
        return [];
	const results = resolveClaims(claims);
	return results.map(x=>lbryVideoDetailToPlatformVideoDetails(x));
}
function resolveClaims(claims) {
	const body = JSON.stringify({
		method: "resolve",
		params: {
			urls: claims
		}
	});
	const resp = http.POST(URL_RESOLVE, body, {
		"Content-Type": "application/json"
	});
	if(resp.code >= 300)
		throw "Failed to resolve claims\n" + resp.body;

	const claimResults = JSON.parse(resp.body).result;
	
	const results = [];
	for(let i = 0; i < claims.length; i++) {
		const claim = claims[i];
		if(claimResults[claim])
			results.push(claimResults[claim]);
	}
	console.log(results);
	return results;
}

//Convert a channel to an AuthorLink
function channelToAuthorLink(channel) {
    return new PlatformAuthorLink(new PlatformID(PLATFORM, channel.id.value, config.id, PLATFORM_CLAIMTYPE),
           			channel.name,
           			channel.url,
           			channel.thumbnail ?? "");
}

//Convert a LBRY Channel (claim) to a PlatformChannel
function lbryChannelToPlatformChannel(lbry, subs = 0) {
	return new PlatformChannel({
		id: new PlatformID(PLATFORM, lbry.claim_id, config.id, PLATFORM_CLAIMTYPE),
		name: lbry.value?.title ?? "",
		thumbnail: lbry.value?.thumbnail?.url ?? "",
		banner: lbry.value?.cover?.url,
		subscribers: subs,
		description: lbry.value?.description ?? "",
		url: lbry.permanent_url,
		links: {}
	});
}

//Convert a LBRY Video (claim) to a PlatformVideo
function lbryVideoToPlatformVideo(lbry) {
	return new PlatformVideo({
		id: new PlatformID(PLATFORM, lbry.claim_id, config.id),
		name: lbry.value?.title ?? "",
		thumbnails: new Thumbnails([new Thumbnail(lbry.value?.thumbnail?.url, 0)]),
		author: new PlatformAuthorLink(new PlatformID(PLATFORM, lbry.signing_channel?.claim_id, config.id, PLATFORM_CLAIMTYPE), 
			lbry.signing_channel?.value?.title ?? "", 
			lbry.signing_channel?.permanent_url ?? "",
			lbry.signing_channel?.value?.thumbnail?.url ?? ""),
		datetime: lbry.timestamp,
		duration: lbry.value?.video?.duration ?? 0,
		viewCount: -1,
		url: lbry.permanent_url,
		shareUrl: lbry.permanent_url.replace("lbry://", URL_BASE + "/"),
		isLive: false
	});
}
//Convert a LBRY Video to a PlatformVideoDetail
function lbryVideoDetailToPlatformVideoDetails(lbry) {
	const headersToAdd = {
		"Origin": "https://odysee.com"
	};

	const sdHash = lbry.value?.source?.sd_hash;
	let source = null;
	if (sdHash) {
		const sources = [];

		const hlsUrl2 = `https://player.odycdn.com/v6/streams/${lbry.claim_id}/${sdHash}/master.m3u8`;
		const hlsResponse2 = http.GET(hlsUrl2, headersToAdd);
		if (hlsResponse2.isOk) {
			sources.push(new HLSSource({
				name: "HLS (v6)",
				url: hlsUrl2,
				duration: lbry.value?.video?.duration ?? 0,
				priority: true,
				requestModifier: {
					headers: headersToAdd
				}
			}));
		} else {
			const hlsUrl = `https://player.odycdn.com/api/v4/streams/tc/${lbry.name}/${lbry.claim_id}/${sdHash}/master.m3u8`;
			const hlsResponse = http.GET(hlsUrl, headersToAdd);
			if (hlsResponse.isOk) {
				sources.push(new HLSSource({
					name: "HLS",
					url: hlsUrl,
					duration: lbry.value?.video?.duration ?? 0,
					priority: true,
					requestModifier: {
						headers: headersToAdd
					}
				}));
			}
		}

		const downloadUrl2 = `https://player.odycdn.com/v6/streams/${lbry.claim_id}/${sdHash.substring(0, 6)}.mp4`;
		console.log("downloadUrl2", downloadUrl2);
		const downloadResponse2 = http.GET(downloadUrl2, { "Range": "bytes=0-10", ... headersToAdd });
		log("downloadResponse2: " + JSON.stringify(downloadResponse2));
		if (downloadResponse2.isOk) {
			sources.push(new VideoUrlSource({
				name: "Original " + (lbry.value?.video?.height ?? 0) + "P (v6)",
				url: downloadUrl2,
				width: lbry.value?.video?.width ?? 0,
				height: lbry.value?.video?.height ?? 0,
				duration: lbry.value?.video?.duration ?? 0,
				container: downloadResponse2.headers["content-type"]?.[0] ?? "video/mp4",
				requestModifier: {
					headers: headersToAdd
				}
			}));
		} else {
			const downloadUrl = `https://player.odycdn.com/api/v4/streams/free/${lbry.name}/${lbry.claim_id}/${sdHash.substring(0, 6)}`;
			const downloadResponse = http.GET(downloadUrl, { "Range": "bytes=0-0", ... headersToAdd });
			if (downloadResponse.isOk) {
				sources.push(new VideoUrlSource({
					name: "Original " + (lbry.value?.video?.height ?? 0) + "P (v4)",
					url: downloadUrl,
					width: lbry.value?.video?.width ?? 0,
					height: lbry.value?.video?.height ?? 0,
					duration: lbry.value?.video?.duration ?? 0,
					container: downloadResponse.headers["content-type"]?.[0] ?? "video/mp4",
					requestModifier: {
						headers: headersToAdd
					}
				}));
			}
		}

		source = {
			video: new VideoSourceDescriptor(sources)
		};
	} else {
		source = {
			video: new VideoSourceDescriptor([
				new VideoUrlSource({
					name: "Original " + (lbry.value?.video?.height ?? 0) + "P",
					url: "https://cdn.lbryplayer.xyz/content/claims/" + lbry.name + "/" + lbry.claim_id + "/stream",
					width: lbry.value?.video?.width ?? 0,
					height: lbry.value?.video?.height ?? 0,
					duration: lbry.value?.video?.duration ?? 0,
					container: lbry.value?.source?.media_type ?? "",
					requestModifier: {
						headers: headersToAdd
					}
				})
			])
		};
	}

	if(IS_TESTING)
		console.log(lbry);
			
	let rating = null;	
	let viewCount = 0;
	const newUserResp = http.GET(URL_USER_NEW, headersToAdd);
	if (newUserResp && newUserResp.isOk) {
		const newUserObj = JSON.parse(newUserResp.body);
		if (newUserObj && newUserObj.success && newUserObj.data) {
			const authToken = newUserObj.data.auth_token;
			const reactionResp = http.POST(URL_REACTIONS, `auth_token=${authToken}&claim_ids=${lbry.claim_id}`, {
				"Content-Type": "application/x-www-form-urlencoded" 
			});
		
			if (reactionResp && reactionResp.isOk) {
				const reactionObj = JSON.parse(reactionResp.body);
				if (reactionObj && reactionObj.success && reactionObj.data && reactionObj.data.others_reactions) {
					const robj = reactionObj.data.others_reactions[lbry.claim_id];
					if (robj) {
						rating = new RatingLikesDislikes(robj.like ?? 0, robj.dislike ?? 0);
					}
				}
			}

			const viewCountResp = http.POST(URL_VIEW_COUNT, `auth_token=${authToken}&claim_id=${lbry.claim_id}`, {
				"Content-Type": "application/x-www-form-urlencoded" 
			});
		
			if (viewCountResp && viewCountResp.isOk) {
				const viewCountObj = JSON.parse(viewCountResp.body);
				if (viewCountObj && viewCountObj.success && viewCountObj.data) {
					viewCount = viewCountObj.data[0] ?? 0;
				}
			}
		}
	}
	
	return new PlatformVideoDetails({
		id: new PlatformID(PLATFORM, lbry.claim_id, config.id),
		name: lbry.value?.title ?? "",
		thumbnails: new Thumbnails([new Thumbnail(lbry.value?.thumbnail?.url, 0)]),
		author: new PlatformAuthorLink(new PlatformID(PLATFORM, lbry.signing_channel.claim_id, config.id, PLATFORM_CLAIMTYPE), 
			lbry.signing_channel.value.title ?? "", 
			lbry.signing_channel.permanent_url,
			lbry.signing_channel.value?.thumbnail?.url ?? ""),
		datetime: lbry.timestamp,
		duration: lbry.value?.video?.duration ?? 0,
		viewCount,
		url: lbry.permanent_url,
		shareUrl: lbry.permanent_url.replace("lbry://", URL_BASE + "/"),
		isLive: false,
		description: lbry.value?.description ?? "",
		rating,
		... source
	});
}

log("LOADED");