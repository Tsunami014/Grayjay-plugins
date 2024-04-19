const USER_AGENT_TABLET = "Mozilla/5.0 (iPad; CPU OS 13_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/87.0.4280.77 Mobile/15E148 Safari/604.1";

const YTM_DOMAIN = "https://music.youtube.com"
const YT_DOMAIN = "https://www.youtube.com"
const YTM_WATCH_URL = YTM_DOMAIN + "/watch?v="
const YTM_BASE_API = YT_DOMAIN + "/youtubei/v1/"
const YTM_PARAMS = "?alt=json"

const info = {
    'context': {
        'client': {
            'clientName': 'ANDROID_MUSIC',
            'clientVersion': '5.16.51',
            'androidSdkVersion': 30
        }
    },
    'header': {
        'User-Agent': 'com.google.android.apps.youtube.music/'
    },
    'api_key': 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
}

const ctx = {
    "context": {
        "client": {
            "clientName": "WEB_REMIX",
            "clientVersion": "1." + new Date().toISOString().split('T')[0].replace(/-/g, '') + ".01.00",
        },
        "user": {},
    }
}

const PLATFORM_ID = new PlatformID("YouTube Music", "YouTube Music", 9876543123456789876543278)

function send_request(endpoint, body, additionalParams = "") {
    Object.assign(body, ctx);
    let headers = {"Accept-Language": "en-US", "Cookie": "PREF=hl=en&gl=US" };
    if(true) //useMobile
		headers["User-Agent"] = USER_AGENT_TABLET;
        //TODO: Make this like it should be
        const resp = http.POST("https://www.youtube.com/youtubei/v1/search?alt=json", JSON.stringify({'query': 'Never gonna give you up', 'context': {'client': {'clientName': 'WEB_REMIX', 'clientVersion': '1.20240415.01.00'}, 'user': {}}}), headers, false);
        return JSON.parse(resp.body);
}

source.enable = function (conf) {
    /**
     * @param conf: SourceV8PluginConfig (the SomeConfig.js)
     */
}

function executeRequest(url, headers = {}, data = null) {
    let baseHeaders = {
        "User-Agent": "Mozilla/5.0",
        "accept-language": "en-US,en"
    };
    if (headers) {
        baseHeaders = {...baseHeaders, ...headers};
    }
    if (data) {
        if (typeof data !== 'string') {
            data = JSON.stringify(data);
        }
    }
    if (!url.toLowerCase().startsWith("http")) {
        throw new Error("Invalid URL");
    }
    const resp = http.POST(url, data, baseHeaders, false);
    return JSON.parse(resp.body);;
}

function player(video_id) {
    const endpoint = `${YTM_BASE_API}player`;
    const query = {
        'videoId': video_id,
        'key': info['api_key'],
        'contentCheckOk': true,
        'racyCheckOk': true
    };
    const endpoint_url = `${endpoint}?${Object.keys(query).map(key => `${key}=${encodeURIComponent(query[key])}`).join('&')}`;
    const headers = {'Content-Type': 'application/json', ...info['header']};
    const response = executeRequest(
        endpoint_url,
        headers,
        {'context': info['context']}
    );
    return response;
}

function streamingData(video_id) {
    let vid_info = player(video_id);
    if ('streamingData' in vid_info) {
        return vid_info['streamingData'];
    } else {
        vid_info = player(video_id);
        if ('streamingData' in vid_info) {
            return vid_info['streamingData'];
        }
        throw new Error(`Could not find streaming data for video with id ${video_id}!!`);
    }
}

function applyDescrambler(streamData) {
    if ('url' in streamData) {
        return null;
    }

    // Merge formats and adaptiveFormats into a single list
    let formats = [];
    if ('formats' in streamData) {
        formats = formats.concat(streamData['formats']);
    }
    if ('adaptiveFormats' in streamData) {
        formats = formats.concat(streamData['adaptiveFormats']);
    }

    // Extract url and s from signatureCiphers as necessary
    for (let i = 0; i < formats.length; i++) {
        if (!('url' in formats[i])) {
            if ('signatureCipher' in formats[i]) {
                let cipherUrl = new URLSearchParams(formats[i]['signatureCipher']);
                formats[i]['url'] = cipherUrl.get('url');
                formats[i]['s'] = cipherUrl.get('s');
            }
        }
        formats[i]['is_otf'] = formats[i]['type'] === 'FORMAT_STREAM_TYPE_OTF';
    }

    return formats;
}

function streams(videoId) {
    let strms = [];

    let streamManifest = applyDescrambler(streamingData(videoId));

    for (let stream of streamManifest) {
        strms.push(stream);
    }

    return strms;
}

source.getHome = function(continuationToken) {
    /**
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    return source.search('Never gonna give you up', 'video', 'relevance', new Map(), continuationToken);
    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeHomeVideoPager(videos, hasMore, context);
}

source.searchSuggestions = function(query) {
    /**
     * @param query: string
     * @returns: string[]
     */

    const suggestions = []; //The suggestions for a specific search query
    return suggestions;
}

source.getSearchCapabilities = function() {
    //This is an example of how to return search capabilities like available sorts, filters and which feed types are available (see source.js for more details) 
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
}

function calculateDuration(duration) {
    const durationParts = duration.split(':');
    return (
        parseInt(durationParts[0]) + 60 * parseInt(durationParts[1])
    );
}

function convertViewCount(viewCount) {
    let scale = 1;
    if (typeof viewCount === 'string') {
        switch (viewCount.slice(-1)) {
            case 'K':
                scale = 1000;
                break;
            case 'M':
                scale = 1000000;
                break;
            case 'B':
                scale = 1000000000;
                break;
            default:
                scale = 1;
                break;
        }
    }
    return parseFloat(viewCount) * scale;
}

source.search = function (query, type, order, filters, continuationToken) {
    /**
     * @param query: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */
    const response = send_request("search", {"query": query});
    const resp = response.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents.slice(1).reduce((acc, i) => {
        const title = i.musicShelfRenderer.title.runs[0].text;
        acc[title] = i.musicShelfRenderer.contents;
        return acc;
    }, {});

    //TODO: Make it just the videos to make there more results

    const videos = resp['Songs'].map(i => { // The results (PlatformVideo)
        const info = i.musicResponsiveListItemRenderer.flexColumns;
        return new PlatformVideo({
            id: PLATFORM_ID,
            name: info[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].text,
            thumbnails: new Thumbnails([
                    new Thumbnail("https://.../...", 720),
                    new Thumbnail("https://.../...", 1080),
                ]),
            author: new PlatformAuthorLink(
                new PlatformID("SomePlatformName", "SomeAuthorID", 0), 
                "SomeAuthorName", 
                "https://platform.com/your/channel/url", 
                "../url/to/thumbnail.png"),
            uploadDate: 1696880568,
            duration: calculateDuration(info[1].musicResponsiveListItemFlexColumnRenderer.text.runs[4].text),
            viewCount: convertViewCount(info[2].musicResponsiveListItemFlexColumnRenderer.text.runs[0].text),
            url: YTM_WATCH_URL + i.musicResponsiveListItemRenderer.playlistItemData.videoId,
            isLive: false
        });
        //Author: info[1].musicResponsiveListItemFlexColumnRenderer.text.runs[0].text,
        //Album: info[1].musicResponsiveListItemFlexColumnRenderer.text.runs[2].text,
    });
    const hasMore = false; // Are there more pages?
    const context = { query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeSearchVideoPager(videos, hasMore, context);
}

source.getSearchChannelContentsCapabilities = function () {
    //This is an example of how to return search capabilities on a channel like available sorts, filters and which feed types are available (see source.js for more details)
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological],
		filters: []
	};
}

source.searchChannelContents = function (url, query, type, order, filters, continuationToken) {
    /**
     * @param url: string
     * @param query: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */

    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { channelUrl: channelUrl, query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeSearchChannelVideoPager(videos, hasMore, context);
}

source.searchChannels = function (query, continuationToken) {
    /**
     * @param query: string
     * @param continuationToken: any?
     * @returns: ChannelPager
     */

    const channels = []; // The results (PlatformChannel)
    const hasMore = false; // Are there more pages?
    const context = { query: query, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeChannelPager(channels, hasMore, context);
}

source.isChannelUrl = function(url) {
    /**
     * @param url: string
     * @returns: boolean
     */

	return REGEX_CHANNEL_URL.test(url);
}

source.getChannel = function(url) {
	return new PlatformChannel({
		//... see source.js for more details
	});
}

source.getChannelContents = function(url, type, order, filters, continuationToken) {
    /**
     * @param url: string
     * @param type: string
     * @param order: string
     * @param filters: Map<string, Array<string>>
     * @param continuationToken: any?
     * @returns: VideoPager
     */

    const videos = []; // The results (PlatformVideo)
    const hasMore = false; // Are there more pages?
    const context = { url: url, query: query, type: type, order: order, filters: filters, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeChannelVideoPager(videos, hasMore, context);
}

source.isContentDetailsUrl = function(url) {
    /**
     * @param url: string
     * @returns: boolean
     */

	return REGEX_DETAILS_URL.test(url);
}

source.getContentDetails = function(url) {
    /**
     * @param url: string
     * @returns: PlatformVideoDetails
     */

	return new PlatformVideoDetails({
		//... see source.js for more details
	});
}

source.getComments = function (url, continuationToken) {
    /**
     * @param url: string
     * @param continuationToken: any?
     * @returns: CommentPager
     */

    const comments = []; // The results (Comment)
    const hasMore = false; // Are there more pages?
    const context = { url: url, continuationToken: continuationToken }; // Relevant data for the next page
    return new SomeCommentPager(comments, hasMore, context);

}
source.getSubComments = function (comment) {
    /**
     * @param comment: Comment
     * @returns: SomeCommentPager
     */

	if (typeof comment === 'string') {
		comment = JSON.parse(comment);
	}

	return getCommentsPager(comment.context.claimId, comment.context.claimId, 1, false, comment.context.commentId);
}

class SomeCommentPager extends CommentPager {
    constructor(results, hasMore, context) {
        super(results, hasMore, context);
    }

    nextPage() {
        return source.getComments(this.context.url, this.context.continuationToken);
    }
}

class SomeHomeVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.getHome(this.context.continuationToken);
	}
}

class SomeSearchVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.search(this.context.query, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}

class SomeSearchChannelVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.searchChannelContents(this.context.channelUrl, this.context.query, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}

class SomeChannelPager extends ChannelPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.searchChannelContents(this.context.query, this.context.continuationToken);
	}
}

class SomeChannelVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}
	
	nextPage() {
		return source.getChannelContents(this.context.url, this.context.type, this.context.order, this.context.filters, this.context.continuationToken);
	}
}
